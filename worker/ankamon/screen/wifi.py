# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Ankamon — ETAP akıllı tahtaları için merkezi log, izleme ve yönetim sunucusu
# Copyright (C) 2026 Özgür Koca <ozgurkoca@gmail.com>
# https://github.com/enseitankado/ankamon
#
# Bu program özgür yazılımdır: Free Software Foundation tarafından yayımlanan
# GNU Affero Genel Kamu Lisansı'nın 3. sürümü ya da (tercihinize bağlı olarak)
# daha sonraki herhangi bir sürümü koşulları altında yeniden dağıtabilir ve/veya
# değiştirebilirsiniz.
#
# Bu program yararlı olması umuduyla dağıtılmaktadır, ancak HİÇBİR GARANTİSİ
# YOKTUR; satılabilirlik veya belirli bir amaca uygunluk garantisi dahi
# verilmez. Ayrıntılar için GNU Affero Genel Kamu Lisansı'na bakınız.
#
# Bu programla birlikte GNU Affero Genel Kamu Lisansı'nın bir kopyasını (LICENSE
# dosyası) almış olmalısınız. Almadıysanız <https://www.gnu.org/licenses/>
# adresine bakınız.
#
# Bu dosyadan (sınıf, işlev ya da işlev içi kod bloğu dahil) alınan her türlü
# parça da AGPL-3.0-or-later ile lisanslıdır: parçayı kullanan türev eser aynı
# lisansla yayımlanmalı, bu telif/atıf bildirimi ve değişiklik notu
# korunmalıdır; değiştirilmiş sürüm ağ üzerinden hizmet olarak sunulursa
# kullanıcılarına kaynak kodu sunulmalıdır (AGPLv3 madde 4, 5, 7(b) ve 13).

"""Sağ menü "Wi-Fi Monitör": tahtanın (sensörün) Wi-Fi kartı, bağlantısı ve çevredeki Wi-Fi vericileri (ws /screen/ws/wifi/<tahta id>).
Bluetooth kullanılmaz (kullanıcı kararı 2026-11-06).

Çoklu tahta penceresi (sınıfta telefon arama) her tahta için ayrı bağlantı açar; "sabit" verici listesi ayrı (PHP
/api/wifimon/fixed), ayırma tarayıcıda yapılır. Bu köprü satırlara telefon kanıtlarını (wifimon_phone_hints.py) ve görülme
geçmişini (wifimon_sightings.py) ekler.

Varsayılan tek atış: bir tarama, sonuç, tahtada durum geri yüklenir, kapanış 1000. `?watch=1`: tarama döngüsü; tarayıcıdan "stop" iletisi
ya da bağlantının kapanması biter. `?probe=1`: her taramadan sonra Wi-Fi trafiği de dinlenir (bkz. wifimon_probe_sniffer.py). `?force=1` (kullanıcı onayı:
tahta kabloyla da bağlı): kart bir ağa bağlı olsa da bağlantısı oturum boyunca kesilip dinlenir, kapanışta yeniden kurulur —
SSH Wi-Fi'den geliyorsa tahta yine dinlemez (bkz. wifi_remote_scan.py). Dinleme olan her turda boards.facts.wifi_monitor
(epoch) yazılır, kapanışta silinir: Tahtalar grid'inin Wi-Fi sütunu "Monitör modu" gösterir (bkz. ui.FactsView.wifiStatus).
Wi-Fi kapalıysa tarama süresince geçici açılır, bağlantı kurulmaz, sonra eski durumuna döner: tahtadaki program ve geri yükleme güvenceleri wifi_remote_scan.py'de. Bu köprü SSH stdin'ine kalp atışı yazar; stdin'in
kapanması (ya da SSH'nin ölmesi) tahtadaki bekçiyi tetikler. Yetki: /screen/ws/ ile aynı ("screen", nginx).
Sunucu iletileri, `phase` alanıyla:
  scanning {info}: tarama başladı.
  data {radio, device, state, connection, rows: [{kind: wifi, name, addr, signal, chan, freq, rate, security, active,
        random, vendor, hints, phone: yes|maybe|"", first_seen, seen_days}], info, at}.
  probes {rows: [{kind: probe, addr, signal, rssi, count, fp, fps, ssids, wps, random, vendor, hints, phone, first_seen, seen_days;
                   rastgele adresliyse addrs (aynı cihaz sayılan adresler), why (gerekçe kodları), dev (cihaz anahtarı)}
        | {kind: client (Wi-Fi'ye bağlı cihaz), addr, bssid, name (bağlı olduğu ağ adı), chan, signal, rssi, count, random,
           vendor, board_name (adres bir tahtanın kablolu/kablosuz MAC'iyse), hints, phone, first_seen, seen_days}],
        devices (yoklama yapan kestirilen cihaz sayısı), clients (bağlı cihaz sayısı),
        note (boşsa dinlendi: nodev|tools|radio|busy|nomon|shared|monfail|sshwifi), secs, at}.
  done {result: restored|shared|none|fail|lock, radio, policy (off: tahtada "Wi-Fi'yi kapat" kuralı var), wifi_temp, wifi_fail}:
        geri yükleme sonucu (radyo durumu boards.facts'e de yazılır), ardından kapanış 1000.
info: {wifi_temp: "0"|"1", wifi_fail, disconnected, forced ("1": bağlantı kullanıcı onayıyla kesildi)}.
Kapanış kodları: 4001 tahta yok · 4002 SSH · 4003 giriş reddedildi · 4009 tahtada nmcli yok · 4010 tahtada /run yazılamıyor.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time

import tornado.websocket

from .. import db
from ..executor.hwfacts import mark_wifi_radio
from . import wifimon_phone_hints, wifimon_probe_merge, wifimon_signal_log, wifimon_sightings
from .wifi_remote_scan import wifimon_remote_command

log = logging.getLogger("ankamon.screen.wifi")

_HEARTBEAT_SECONDS = 5
# Pencere kapanınca tahtadaki geri yüklemenin bitip @@DONE'un gelmesi için beklenen en uzun süre.
_CLOSE_GRACE_SECONDS = 45
_ANSI_RE = re.compile(r"\x1b\[[0-9;]*[A-Za-z]|[\x01\x02]")


def _fields(line: str) -> list[str]:
    """nmcli -t: alanlar ':' ile ayrılır, alan içindeki ':' '\\:' olarak kaçar."""
    return [p.replace("\\:", ":").replace("\\\\", "\\") for p in re.split(r"(?<!\\):", line)]


def _keyvals(lines: list[str]) -> dict:
    return dict(line.split("=", 1) for line in lines if "=" in line)


def rssi_to_percent(rssi: int) -> int:
    """-100 dBm ve altı %0, -50 dBm ve üstü %100 (NetworkManager'ın Wi-Fi yüzdesine yakın ölçek)."""
    return max(0, min(100, 2 * (rssi + 100)))


def parse(sections: dict) -> dict:
    out = {"phase": "data", "radio": (sections.get("RADIO") or [""])[0].strip(), "device": None, "state": None,
           "connection": None, "rows": [], "info": _keyvals(sections.get("INFO", [])), "at": int(time.time())}
    for line in sections.get("DEV", []):
        f = _fields(line)
        if len(f) >= 4 and f[1] == "wifi":
            out.update(device=f[0], state=f[2], connection=f[3] if f[3] not in ("", "--") else None)
            break
    wifi = []
    for line in sections.get("LIST", []):
        f = _fields(line)
        if len(f) < 8:
            continue
        wifi.append({
            "kind": "wifi", "active": f[0].strip() == "*", "addr": f[1], "name": f[2], "chan": f[3], "freq": f[4], "rate": f[5],
            "signal": int(f[6]) if f[6].isdigit() else 0, "security": f[7]})
    for row in wifi:
        wifimon_phone_hints.annotate_wifi_ap(row)
    # Gerçek dBm (iw scan dump; yoksa yüzdeden tahmin) ve bant — sensör başına sinyal istatistiği için (wifimon_signal_log).
    wifimon_signal_log.attach_dbm(wifi, wifimon_signal_log.parse_iw_dump(sections.get("IWDUMP", [])))
    out["rows"] = sorted(wifi, key=lambda n: (-n["active"], -(n["signal"] if n["signal"] is not None else -1)))
    return out


def parse_probes(sections: dict) -> dict:
    """@@PROBE (dinleyicinin JSON satırları) → probes iletisi. Yoklama cihaz kestirimi: kalıcı adres başına bir cihaz, rastgele
    adresler aynı cihaz kestirimiyle (WPS kimliği, ağ listesi, sıra numarası sürekliliği, parmak izi + yakın sinyal — bkz.
    wifimon_probe_merge.py) tek satırda birleşir (addrs, why, dev alanları). Bağlı cihazlar
    (t: "c") ayrı satırlar: telefonun ağ başına rastgele adresi o ağda sabit kaldığından adres başına bir cihaz sayılır."""
    rows, clients = [], []
    for line in sections.get("PROBE", []):
        try:
            e = json.loads(line)
        except ValueError:
            continue
        rssi = e.get("rssi")
        if e.get("t") == "c":
            clients.append({"kind": "client", "addr": str(e.get("addr", "")).upper(), "bssid": str(e.get("bssid", "")).upper(),
                            "name": str(e.get("ssid") or ""), "chan": str(e.get("chan") or ""), "rssi": rssi,
                            "signal": rssi_to_percent(rssi) if isinstance(rssi, int) else None, "count": int(e.get("count") or 0),
                            "freq": "", "rate": "", "security": "", "active": False})
            continue
        rows.append({"kind": "probe", "addr": str(e.get("addr", "")).upper(), "name": ", ".join(e.get("ssids") or []),
                     "ssids": e.get("ssids") or [], "rssi": rssi, "signal": rssi_to_percent(rssi) if isinstance(rssi, int) else None,
                     "count": int(e.get("count") or 0), "fp": str(e.get("fp") or ""),
                     "fps": [str(f) for f in e.get("fps") or []][:4], "seq": e.get("seq"), "ts": e.get("ts"),
                     "wps": {str(k): str(v)[:40] for k, v in e["wps"].items()} if isinstance(e.get("wps"), dict) else None,
                     "chan": "", "freq": "", "rate": "", "security": "", "active": False})
    for row in rows:
        wifimon_phone_hints.annotate_probe(row)
    for row in clients:
        wifimon_phone_hints.annotate_client(row)
    merged = wifimon_probe_merge.merge_random([r for r in rows if r["random"]])
    for row in merged:
        wifimon_phone_hints.annotate_probe(row)  # birleşen adreslerden gelen WPS bilgisiyle ipuçları yeniden
    rows = [r for r in rows if not r["random"]] + merged
    for row in rows:
        row.pop("seq", None)
        row.pop("ts", None)
    devices = len({r["addr"] for r in rows})
    info = _keyvals(sections.get("PROBEINFO", []))
    rows += clients
    rows.sort(key=lambda r: -(r["signal"] if r["signal"] is not None else -1))
    return {"phase": "probes", "rows": rows, "devices": devices, "clients": len(clients), "note": info.get("note", ""),
            "secs": int(info["secs"]) if info.get("secs", "").isdigit() else None, "at": int(time.time())}


def _wifimon_build(parser, board_id: int, sections: dict) -> dict:
    """İş parçacığında: ayrıştırma (ilk çağrıda ~8 MB'lık üretici tablosu yüklenir) + görülme geçmişi (veritabanı)."""
    data = parser(sections)
    _wifimon_mark_boards(data["rows"])
    wifimon_sightings.record_and_annotate(board_id, data["rows"])
    wifimon_signal_log.record(board_id, data["rows"])  # güvenilir vericilerin konumu için sinyal istatistiği (göç 050)
    return data


def _wifimon_mark_boards(rows: list[dict]) -> None:
    """Wi-Fi'ye bağlı ya da ağ arayan cihaz bir tahtanın kendisiyse (boards.mac kablolu, boards.wifi_mac kablosuz — göç 043)
    satıra board_name eklenir: arayüz onu sabit sayar (sınıftaki telefon değil, komşu tahta). Hata izlemeyi durdurmaz."""
    devices = [r for r in rows if r["kind"] in ("client", "probe") and not r.get("random")]
    if not devices:
        return
    try:
        with db.connect() as conn:
            got = conn.execute(
                """SELECT upper(m) AS mac, coalesce(nullif(b.label, ''), b.hostname, '#' || b.id) AS name
                   FROM boards b, unnest(ARRAY[b.mac::text, b.wifi_mac::text]) AS m
                   WHERE m IS NOT NULL AND upper(m) = ANY(%s::text[])""",
                ([r["addr"] for r in devices],)).fetchall()
    except Exception as exc:
        log.warning("Wi-Fi Monitör tahta MAC eşlemesi yapılamadı: %s", exc)
        return
    names = {g["mac"]: g["name"] for g in got}
    for row in devices:
        name = names.get(row["addr"])
        if name:
            row["board_name"], row["phone"] = name, ""
            row["hints"] = [f"Ankamon tahtası ({name})"]


def _store_monitor(board_id: int, on: bool) -> None:
    """boards.facts.wifi_monitor: dinleme (monitör kipi) olan turun zamanı; kapanışta silinir. Tahtalar grid'i bunu "Monitör
    modu" diye gösterir (tazeyse — bkz. ui.FactsView.wifiStatus; worker çökerse damga eskir, sütun kendiliğinden düzelir)."""
    try:
        with db.connect() as conn:
            if on:
                conn.execute("UPDATE boards SET facts = facts || jsonb_build_object('wifi_monitor', %s::bigint) WHERE id = %s",
                             (int(time.time()), board_id))
            else:
                conn.execute("UPDATE boards SET facts = facts - 'wifi_monitor' WHERE id = %s", (board_id,))
    except Exception as exc:  # gösterge yazılamazsa izleme sürer
        log.warning("Wi-Fi monitör durumu yazılamadı (tahta %s): %s", board_id, exc)


def _store_radio(board_id: int, radio: str, state: str | None = None) -> None:
    """Kartın o anki radyo durumunu boards.facts'e yazar — Tahtalar grid'inin Wi-Fi sütunu anında doğru olsun (kullanıcı isteği):
    pencere açılınca ilk taramadaki durum (ör. geçici açıldı), kapanınca geri yüklemeden sonraki durum. Kapalıysa bağlantı
    alanları da silinir (hwfacts.mark_wifi_radio); açıksa radyo ve (biliniyorsa) kart durumu yazılır."""
    if radio not in ("enabled", "disabled"):
        return
    try:
        with db.connect() as conn:
            if radio == "disabled":
                mark_wifi_radio(conn, board_id, radio)
            else:
                conn.execute("""UPDATE boards SET facts = facts || jsonb_build_object('wifi_radio', 'enabled')
                                  || CASE WHEN %s::text IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('wifi_state', %s::text) END
                                WHERE id = %s AND facts->>'wifi_iface' IS NOT NULL""", (state, state, board_id))
    except Exception as exc:  # durum yazılamazsa sonraki donanım toplaması düzeltir
        log.warning("Wi-Fi radyo durumu yazılamadı (tahta %s): %s", board_id, exc)


class WifiSocket(tornado.websocket.WebSocketHandler):
    proc: asyncio.subprocess.Process | None = None

    def initialize(self, lookup, ssh_opts):
        self._lookup = lookup
        self._ssh_opts = ssh_opts

    async def open(self, board_id: str):
        found = await asyncio.to_thread(self._lookup, int(board_id))
        if found is None:
            self.close(4001, "board")
            return
        board, ssh_user, password = found
        self._board_id = int(board_id)
        watch = self.get_argument("watch", "0") == "1"
        probe = self.get_argument("probe", "0") == "1"
        force = probe and self.get_argument("force", "0") == "1"
        env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "SSHPASS": password}
        self.proc = await asyncio.create_subprocess_exec(
            "sshpass", "-e", "ssh", *self._ssh_opts, f"{ssh_user}@{board['ip']}", wifimon_remote_command(watch, probe, force),
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL, env=env,
        )
        self._beat_task = asyncio.ensure_future(self._heartbeat())
        asyncio.ensure_future(self._pump())

    async def _heartbeat(self):
        """Tahtadaki bekçinin kirası: kesilirse (ağ koptu, süreç öldü) tahta durumu kendisi geri yükler."""
        proc = self.proc
        try:
            while proc.returncode is None and not proc.stdin.is_closing():
                proc.stdin.write(b"k\n")
                await proc.stdin.drain()
                await asyncio.sleep(_HEARTBEAT_SECONDS)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _end_remote(self):
        """stdin EOF: tahtada bekçi taramayı bitirir, durumu geri yükler, @@DONE gelir."""
        if self.proc and self.proc.stdin and not self.proc.stdin.is_closing():
            self.proc.stdin.close()

    async def _pump(self):
        proc = self.proc
        sections: dict = {}
        current = None
        finished = False
        stored = None  # boards.facts'e son yazılan (radyo, kart durumu): her taramada değil, değişince yazılır
        monitoring = False  # bu oturum boards.facts.wifi_monitor yazdı mı (kapanışta silinir)
        try:
            while True:
                raw = await proc.stdout.readline()
                if not raw:
                    break
                line = raw.decode("utf-8", "replace").rstrip("\n")
                if line == "@@START":
                    await self.write_message(json.dumps(
                        {"phase": "scanning", "info": _keyvals(sections.get("INFO", []))}, ensure_ascii=False))
                    sections, current = {}, None
                elif line == "@@END":
                    data = await asyncio.to_thread(_wifimon_build, parse, self._board_id, sections)
                    now = (data.get("radio") or "", data.get("state"))
                    if now != stored:
                        stored = now
                        await asyncio.to_thread(_store_radio, self._board_id, now[0], now[1])
                    await self.write_message(json.dumps(data, ensure_ascii=False))
                    sections, current = {}, None
                elif line == "@@PEND":
                    data = await asyncio.to_thread(_wifimon_build, parse_probes, self._board_id, sections)
                    if not data["note"]:
                        monitoring = True
                        await asyncio.to_thread(_store_monitor, self._board_id, True)
                    await self.write_message(json.dumps(data, ensure_ascii=False))
                    sections, current = {}, None
                elif line == "@@DONE":
                    finished = True
                    restored = _keyvals(sections.get("RESTORED", []))
                    if monitoring:
                        monitoring = False
                        await asyncio.to_thread(_store_monitor, self._board_id, False)
                    await asyncio.to_thread(_store_radio, self._board_id, restored.get("radio", ""))
                    await self.write_message(json.dumps({"phase": "done", **restored}, ensure_ascii=False))
                    sections, current = {}, None
                elif line.startswith("@@"):
                    current = sections.setdefault(line[2:], [])
                elif current is not None and line:
                    current.append(line)
        except tornado.websocket.WebSocketClosedError:
            pass
        finally:
            self._end_remote()
            if proc.returncode is None and not finished:
                proc.kill()
            rc = await proc.wait()
            if monitoring:
                await asyncio.to_thread(_store_monitor, self._board_id, False)
        if self.ws_connection is not None:
            if finished:
                self.close(1000, "done")
            else:
                self.close({49: 4009, 48: 4010, 5: 4003, 255: 4002}.get(rc, 4005), f"exit {rc}")

    def on_message(self, message):
        if message == "stop":
            self._end_remote()

    def on_close(self):
        # Pencere kapandı: stdin EOF ile tahtadaki program durumu geri yükler ve @@DONE yazar; _pump onu okuyup radyo durumunu
        # veritabanına işler. SSH hemen öldürülmez (yoksa son durum yazılamazdı); takılırsa bir süre sonra öldürülür.
        self._end_remote()
        proc = self.proc
        if proc and proc.returncode is None:
            asyncio.get_event_loop().call_later(_CLOSE_GRACE_SECONDS, lambda: proc.returncode is None and proc.kill())
