"""Tahta oturumlarının "tahta çevrimdışı oldu" ('offline') kapanışlarını netleştirir (göç 023).

Kapanış mesajı gelmeden tahta çevrimdışı olunca oturum 'offline' kapatılır (bkz. board_sessions.py) —
ama bu tek etiket çok farklı durumları topluyordu (kullanıcı isteği). Tahta yeniden erişilebilir olunca
SSH ile kendi açılış günlüğüne (journalctl, kalıcı) bakılır; oturumun açık olduğu açılışın nasıl bittiği:

  - systemd kapanış izi ("Journal stopped", systemd-shutdown, "System is powering down/rebooting") varsa:
    düzenli kapatma ('shutdown') ya da yeniden başlatma ('reboot') — menüden/komutla.
  - İz yoksa açılış ANİDEN bitmiştir. Pardus eta-shutdown (/etc/pardus/eta-shutdown.conf) da kapatmayı
    `poweroff -f` ile yapar (iz bırakmaz — elektrik kesintisiyle aynı görünür); ayrım ayarına göre yapılır:
      * [AUTO_SHUTDOWN] enabled ve kapanış o saatte (10 dk önce "1 saat ertele" uyarısı; ertelenirse saat
        kayar): 'auto_timed';
      * [TIMED_MODE] mode = shutdown ve oturum en az o süre (işlem yapılmayınca kapanma, en az 5 dk) açık
        kaldıysa: 'auto_idle' (girişin kendisi bir etkinliktir; daha kısa oturum bununla kapanamaz);
      * aksi halde ya da sonraki açılışta dosya sistemi onarıldıysa (EXT4 recovery): 'power_loss' —
        elektrik kesintisi / güç düğmesine basılı tutarak zorla kapatma.
  - Oturum tahtanın ŞU ANKİ açılışındaysa tahta kapanmamıştır: 'network' (yalnız ağ bağlantısı koptu).

Doğrulama (2026-10-19, "B Blok - Arge 1 (AMD)"): felsefe oturumu 09:28'de açıldı, 09:48:19'da açılış
günlüğü aniden bitti, `last -x` "crash" — eta-shutdown 20 dk boşta kapatmasıydı (poweroff -f).
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from ..executor import ansible
from ..executor.jobs import _board_access

log = logging.getLogger(__name__)

_LOOKBACK_DAYS = 30
_BATCH = 200

# Tahtada (salt okuma): son açılışların başı/sonu (epoch), kapanış izi, tür, sonraki açılışta EXT4 onarımı;
# eta-shutdown ayarı; şimdiki açılışın başı; saat dilimi.
SCRIPT = r"""
for b in $(journalctl --list-boots --no-pager -q 2>/dev/null | awk '$1 < 0 {print $1}' | tail -15); do
  s=$(journalctl -b "$b" -o short-unix -q --no-pager 2>/dev/null | head -1 | cut -d' ' -f1)
  e=$(journalctl -b "$b" -n 1 -o short-unix -q --no-pager 2>/dev/null | cut -d' ' -f1)
  tail=$(journalctl -b "$b" -n 300 -q --no-pager -o cat 2>/dev/null)
  clean=0; printf '%s\n' "$tail" | grep -qE 'Journal stopped|systemd-shutdown|System is powering down|System is rebooting' && clean=1
  kind=poweroff; printf '%s\n' "$tail" | grep -qE 'System is rebooting|Reached target.*Reboot|reboot\.target' && kind=reboot
  rec=0; journalctl -b "$((b + 1))" -k -q --no-pager -o cat 2>/dev/null | head -600 | grep -qiE 'EXT4-fs.*(recovery complete|orphan)' && rec=1
  echo "B ${s%.*} ${e%.*} $clean $kind $rec"
done
echo "N $(journalctl -b 0 -o short-unix -q --no-pager 2>/dev/null | head -1 | cut -d' ' -f1 | cut -d. -f1)"
echo "C $(tr '\n' ';' < /etc/pardus/eta-shutdown.conf 2>/dev/null)"
echo "T $(date +%z)"
"""


def run(conn) -> None:
    rows = conn.execute(f"""
        SELECT s.id, s.board_id, extract(epoch FROM s.started_at)::bigint AS started, host(b.ip) AS ip
        FROM board_sessions s JOIN boards b ON b.id = s.board_id
        WHERE s.end_reason = 'offline' AND s.end_checked_at IS NULL
          AND b.online AND b.ssh_ok AND b.ip IS NOT NULL
          AND s.started_at > now() - interval '{_LOOKBACK_DAYS} days'
        ORDER BY s.started_at LIMIT {_BATCH}
    """).fetchall()
    if not rows:
        return
    user, password = _board_access(conn)
    if not password:
        return
    hosts = {r["board_id"]: r["ip"] for r in rows}
    results = ansible.run([{"id": i, "ip": ip} for i, ip in hosts.items()], user, password, body=SCRIPT, timeout=90)
    for r in rows:
        res = results.get(r["board_id"]) or {}
        if res.get("status") != "ok":
            continue  # bir sonraki turda yeniden denenir (tahta erişilebilirken)
        reason, detail, end = classify(r["started"], *parse(res.get("output", "")))
        conn.execute(
            """UPDATE board_sessions SET end_reason = COALESCE(%s, end_reason), end_detail = %s,
                      ended_at = COALESCE(to_timestamp(%s), ended_at), end_checked_at = now()
               WHERE id = %s""",
            (reason, detail, end, r["id"]))
        log.info("oturum #%s kapanışı: %s (%s)", r["id"], reason or "offline", detail or "—")


def parse(output: str) -> tuple[list[tuple], int | None, dict, timezone]:
    """→ (açılışlar [(başlangıç, bitiş, düzenli, tür, onarım)], şimdiki açılış başı, eta-shutdown ayarı, saat dilimi)."""
    boots, now_start, conf, tz = [], None, {}, timezone.utc
    for line in output.splitlines():
        parts = line.split()
        if line.startswith("B ") and len(parts) == 6 and parts[1].isdigit() and parts[2].isdigit():
            boots.append((int(parts[1]), int(parts[2]), parts[3] == "1", parts[4], parts[5] == "1"))
        elif line.startswith("N ") and len(parts) == 2 and parts[1].isdigit():
            now_start = int(parts[1])
        elif line.startswith("C "):
            section = ""
            for item in line[2:].split(";"):
                item = item.strip()
                if item.startswith("[") and item.endswith("]"):
                    section = item[1:-1]
                elif "=" in item:
                    key, _, value = item.partition("=")
                    conf[f"{section}.{key.strip()}"] = value.strip().strip('"').lower()
        elif line.startswith("T ") and len(parts) == 2 and len(parts[1]) == 5:
            sign = -1 if parts[1][0] == "-" else 1
            tz = timezone(sign * timedelta(hours=int(parts[1][1:3]), minutes=int(parts[1][3:5])))
    return boots, now_start, conf, tz


def _int(conf: dict, key: str, default: int = 0) -> int:
    try:
        return int(conf.get(key, default))
    except ValueError:
        return default


def classify(started: int, boots: list[tuple], now_start: int | None, conf: dict, tz: timezone
             ) -> tuple[str | None, str | None, int | None]:
    """Oturum başlangıcı (epoch) → (end_reason, end_detail, gerçek bitiş epoch). Bilinemezse (None, None, None)."""
    if now_start is not None and started >= now_start - 60:
        return "network", "Tahta kapanmadı — yalnız ağ bağlantısı kesildi", None
    boot = next((b for b in boots if b[0] - 60 <= started <= b[1] + 60), None)
    if boot is None:
        return None, None, None  # açılış günlüğü artık yok (eski/silinmiş): 'offline' kalır
    _start, end, clean, kind, repaired = boot
    if clean:
        if kind == "reboot":
            return "reboot", "Tahta yeniden başlatıldı", end
        return "shutdown", "Tahta kapatıldı (menüden ya da komutla)", end
    if repaired:
        return "power_loss", "Elektrik kesintisi ya da zorla kapatma (açılışta dosya sistemi onarıldı)", end
    # eta-shutdown sabit saatte kapanma: uyarı 10 dk önce; "1 saat ertele" her basışta saati 1 sa kaydırır.
    if conf.get("AUTO_SHUTDOWN.enabled") == "true":
        local = datetime.fromtimestamp(end, tz)
        at = local.replace(hour=_int(conf, "AUTO_SHUTDOWN.hour") % 24, minute=_int(conf, "AUTO_SHUTDOWN.minute") % 60,
                           second=0, microsecond=0)
        late = (local - at).total_seconds()
        if -120 <= late <= 4 * 3600:
            postponed = int((late + 300) // 3600)
            return ("auto_timed", f"Otomatik kapandı (saat {at:%H:%M} kapanma ayarı"
                    + (f", {postponed} kez ertelendi" if postponed else "") + "; uyarıda iptal edilmedi)", end)
    # eta-shutdown işlem yapılmayınca kapanma (en az 5 dk); giriş bir etkinlik olduğundan oturum en az o kadar sürmüş olmalı.
    if conf.get("TIMED_MODE.mode") == "shutdown":
        idle = max(5, _int(conf, "TIMED_MODE.hour") * 60 + _int(conf, "TIMED_MODE.minute"))
        if end - started >= idle * 60 - 90:
            return "auto_idle", f"Otomatik kapandı: {idle} dk işlem yapılmadı (ETAP otomatik kapanma)", end
    return "power_loss", "Elektrik kesintisi ya da güç düğmesine basılı tutularak kapatıldı", end
