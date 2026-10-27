# SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Ankamon logs toplayıcısı — supervisord olay dinleyicisi (eventlistener).

supervisord'un yerleşik olay protokolüyle (http://supervisord.org/events.html) üç tür olay alır:
  - PROCESS_LOG_STDOUT/STDERR: servislerin çıktı satırları → rules.classify ile süzülür (uyarı/hata,
    Python traceback'i, PHP istisnası …); bilinen gürültü atlanır.
  - PROCESS_STATE_*: beklenmedik çıkış, BACKOFF (yeniden başlatılıyor), FATAL (vazgeçildi), toparlanma.
  - TICK_60: darboğaz denetimi (bkz. health) + tekrar özetleri.
Kayıtlar activity_log'a yazılır (arayüzün alt çubuğu "Ankamon logs"). Aynı kayıt DEDUP_SECONDS içinde
tekrarlarsa bir kez yazılır, pencere kapanınca "N kez tekrarlandı" özeti düşer; dakikada en çok
MAX_PER_MINUTE kayıt (log seli akışı doldurmasın). Veritabanı erişilemezken kayıtlar bellekte bekler.

stdout supervisord ile protokol kanalıdır — bu süreç kendi loglarını yalnız stderr'e yazar.
"""

from __future__ import annotations

import codecs
import collections
import logging
import sys
import time

from .. import db
from . import rules
from .health import Health

logging.basicConfig(level=logging.INFO, stream=sys.stderr, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("ankamon.logwatch")

SELF = "logwatch"
DEDUP_SECONDS = 600
MAX_PER_MINUTE = 30
MESSAGE_MAX = 300
# Tek seferlik/kısa ömürlü programlar: olağan çıkışları kayıt değildir.
ONESHOT = {"dbinit"}


class Watch:
    def __init__(self):
        self.conn = None
        self.pending: collections.deque = collections.deque(maxlen=500)  # veritabanı yokken bekleyenler
        self.seen: dict[str, list] = {}  # dedup anahtarı → [ilk zaman, tekrar sayısı, düzey, kaynak, ileti]
        self.minute = (0, 0, 0)  # (dakika, yazılan, atlanan)
        self.crashed: set[str] = set()
        self.health = Health()
        self.written = 0
        self.db_down = False

    # --- kayıt -------------------------------------------------------------------------------------
    def emit(self, level: str, source: str, message: str, detail: str = "", dedup: bool = True):
        message = " ".join(message.split())
        if len(message) > MESSAGE_MAX:
            detail = message + ("\n\n" + detail if detail else "")
            message = message[:MESSAGE_MAX - 1] + "…"
        now = time.time()
        if dedup:
            key = rules.dedup_key(source, level, message)
            entry = self.seen.get(key)
            if entry and now - entry[0] < DEDUP_SECONDS:
                entry[1] += 1
                return
            self.seen[key] = [now, 0, level, source, message]
        minute, written, skipped = self.minute
        if int(now // 60) != minute:
            if skipped:
                self.pending.append(("warn", SELF, f"Log seli: son dakikada {skipped} kayıt daha atlandı", ""))
            minute, written, skipped = int(now // 60), 0, 0
        if written >= MAX_PER_MINUTE:
            self.minute = (minute, written, skipped + 1)
            return
        self.minute = (minute, written + 1, skipped)
        self.pending.append((level, source, message, detail))
        self.flush()

    def flush(self):
        if not self.pending:
            return
        try:
            if self.conn is None or self.conn.closed:
                self.conn = db.connect()
            # activity.record hatayı yutar; burada yazılamayan kayıt kaybolmasın diye doğrudan yazılır.
            while self.pending:
                level, source, message, detail = self.pending[0]
                self.conn.execute("INSERT INTO activity_log (level, message, source, detail) VALUES (%s, %s, %s, %s)",
                                  (level, message, source[:40], detail[:8000]))
                self.pending.popleft()
                self.written += 1
                if self.written % 50 == 0:
                    self.conn.execute("DELETE FROM activity_log WHERE id < (SELECT max(id) - 2000 FROM activity_log)")
            if self.db_down:
                log.info("veritabanına yeniden yazılabiliyor")
                self.db_down = False
        except Exception as exc:  # veritabanı henüz açılmadı/çöktü: kayıtlar bekler, sonraki olayda denenir
            if not self.db_down:  # kesinti başına bir kez (her olayda yazıp konteyner çıktısını doldurmasın)
                log.warning("kayıt yazılamadı, veritabanı bekleniyor: %s", str(exc).splitlines()[0])
                self.db_down = True
            self.conn = None

    def summarize(self):
        """Pencere kapanan tekrarların özetini yazar, eski anahtarları atar."""
        now = time.time()
        for key, (first, repeats, level, source, message) in list(self.seen.items()):
            if now - first >= DEDUP_SECONDS:
                del self.seen[key]
                if repeats:
                    minutes = DEDUP_SECONDS // 60
                    self.emit(level, source, f"{message} — son {minutes} dakikada {repeats} kez daha", dedup=False)

    # --- olaylar ------------------------------------------------------------------------------------
    def on_log(self, headers: dict, data: str):
        source = headers.get("processname", "?")
        if source == SELF:
            return
        current = None  # (düzey, ileti, ayrıntı satırları)
        for line in data.splitlines():
            if current and rules.is_continuation(line):
                current[2].append(line)
                continue
            if current:
                self._emit_line(source, *current)
                current = None
            hit = rules.classify(line)
            if hit:
                current = (hit[0], hit[1], [])
        if current:
            self._emit_line(source, *current)

    def _emit_line(self, source: str, level: str, message: str, lines: list[str]):
        detail = "\n".join(lines)
        if message == "Python hatası (traceback)" and lines:
            message = f"Python hatası: {lines[-1].strip()}"  # son satır istisnanın kendisidir
        elif lines and lines[-1] and not lines[-1][:1].isspace() and "Traceback" in detail:
            message += f" — {lines[-1].strip()}"
        if rules.is_noise(source, message):
            return
        self.emit(level, source, message, detail)

    def on_state(self, event: str, headers: dict):
        name = headers.get("processname", "?")
        if name == SELF:
            return
        state = event.removeprefix("PROCESS_STATE_")
        if state == "EXITED" and headers.get("expected") == "0" and name not in ONESHOT:
            self.crashed.add(name)
            self.emit("error", name, f"Servis beklenmedik şekilde durdu: {name} ({headers.get('from_state', '')} → "
                                     "EXITED); supervisord yeniden başlatıyor", dedup=False)
        elif state == "BACKOFF":
            self.crashed.add(name)
            self.emit("warn", name, f"Servis açılırken hemen kapandı: {name} (yeniden deneniyor)")
        elif state == "FATAL":
            self.crashed.add(name)
            self.emit("error", name, f"Servis başlatılamadı, vazgeçildi (FATAL): {name} — Sistem sayfasından "
                                     "ya da konteyner yeniden başlatılarak açılabilir", dedup=False)
        elif state == "RUNNING" and name in self.crashed:
            self.crashed.discard(name)
            self.emit("info", name, f"Servis yeniden çalışıyor: {name}", dedup=False)

    def on_tick(self):
        self.summarize()
        if self.conn is None or self.conn.closed:
            try:
                self.conn = db.connect()
            except Exception:
                self.conn = None
        for level, message, detail in self.health.check(self.conn):
            self.emit(level, "sistem", message, detail, dedup=False)
        self.flush()

    def handle(self, event: str, headers: dict, payload: str):
        if event.startswith("PROCESS_LOG_"):
            head, _, data = payload.partition("\n")
            self.on_log(dict(tok.split(":", 1) for tok in head.split() if ":" in tok), data)
        elif event.startswith("PROCESS_STATE_"):
            self.on_state(event, dict(tok.split(":", 1) for tok in payload.split() if ":" in tok))
        elif event == "TICK_60":
            self.on_tick()


def _read_chars(inp, count: int) -> str:
    """Olay gövdesini oku. supervisord len'i KARAKTER sayısı olarak verir (len(str)), ama UTF-8 bayt yollar:
    bayt sayısıyla okumak Türkçe/"…" içeren satırda gövdeyi yarım bırakır, kalan baytlar sonraki başlık sanılır
    ve dinleyici gelmemiş bir olaya yanıt verir (supervisord bunu protokol ihlali sayıp olay göndermeyi keser).
    Her karakter en az bir bayt olduğundan eksik karakter kadar bayt okumak hiçbir zaman fazla okumaz."""
    decoder = codecs.getincrementaldecoder("utf-8")("replace")
    text = ""
    while len(text) < count:
        chunk = inp.read(count - len(text))
        if not chunk:
            break
        text += decoder.decode(chunk)
    return text


def main():
    watch = Watch()
    out, inp = sys.stdout, sys.stdin.buffer
    log.info("Ankamon logs toplayıcısı başladı")
    while True:
        out.write("READY\n")
        out.flush()
        header = inp.readline().decode("utf-8", "replace")
        if not header:
            return  # supervisord kapandı
        headers = dict(tok.split(":", 1) for tok in header.split() if ":" in tok)
        payload = _read_chars(inp, int(headers.get("len", "0")))
        try:
            watch.handle(headers.get("eventname", ""), headers, payload)
        except Exception:  # tek bir olay dinleyiciyi düşürmesin (düşerse supervisord olayları biriktirir)
            log.exception("olay işlenemedi: %s", headers.get("eventname"))
        out.write("RESULT 2\nOK")
        out.flush()


if __name__ == "__main__":
    main()
