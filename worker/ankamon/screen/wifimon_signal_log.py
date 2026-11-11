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

"""Wi-Fi Monitör sinyal kaydı (wifimon_signal_stats, göç 050): sensör (tahta) başına vericilerin bant bant sinyal istatistiği.

Amaç (kullanıcı isteği 2026-11-11): güvenilir vericilerin (okulun erişim noktaları, sabit cihazlar) hangi sensörün yanında
durduğunu bulmak. Güvenilir cihazlar sensörlerin birkaç metre yakınında sabittir; hangi sensör hangi bantta ne güçte duyuyor,
ortalaması/sapması ne — Güvenilir listesi penceresi bunlardan konum önerir, kullanıcı açılır listeden sensörü seçip kaydeder
(backend WifimonLocationsApi). 5 GHz duvar/kapıdan 2,4 GHz'ten çok daha fazla zayıflar: bir sensörün 5 GHz'i güçlü duyması o
vericinin aynı odada olduğunun güçlü işaretidir; bantlar bu yüzden ayrı tutulur.

Wi-Fi Monitör penceresi açıkken her taramada (sürekli izlemede ~her tur) yazılır; satır = adres × sensör × bant × gün, toplamlar
(n, Σ dBm, Σ dBm², en düşük/yüksek, son). Ham ölçüm saklanmaz (disk). Yazılanlar: bütün erişim noktaları (BSSID — rastgele de olsa
paylaşım noktası boyunca sabit) ve kalıcı adresli Wi-Fi cihazları (bağlı/arayan; rastgele adres dakikalar içinde değişir) —
güvenilir işaretlenmeden önceki geçmiş de kalsın diye yalnız güvenilirler değil. 90 günden eski günler silinir.

dBm kaynağı: erişim noktasında tahtanın `iw dev <kart> scan dump` ölçümü (@@IWDUMP); yoksa NetworkManager yüzdesinden tahmin
(NM'nin dBm → % dönüşümünün tersi; n_est sayılır, arayüz "tahmini" der). Dinlenen cihazda radiotap RSSI'si (gerçek dBm).
Hata Wi-Fi Monitör'ü durdurmaz.
"""

from __future__ import annotations

import logging
import re
import time

from .. import db

log = logging.getLogger("ankamon.screen.wifimon_signal_log")

_RETENTION_DAYS = 90
_last_prune = 0.0
_MAC_RE = re.compile(r"^BSS ([0-9a-fA-F:]{17})")
_NUM_RE = re.compile(r"(-?\d+(?:\.\d+)?)")


def parse_iw_dump(lines: list[str]) -> dict[str, tuple[float | None, float | None]]:
    """`iw scan dump` süzülmüş satırları (BSS / freq: / signal:) → {BSSID (büyük harf): (frekans MHz, dBm)}."""
    out: dict[str, list] = {}
    cur = None
    for line in lines or []:
        m = _MAC_RE.match(line)
        if m:
            cur = out.setdefault(m.group(1).upper(), [None, None])
            continue
        if cur is None:
            continue
        text = line.strip()
        num = _NUM_RE.search(text.split(":", 1)[1] if ":" in text else "")
        if not num:
            continue
        if text.startswith("freq:") and cur[0] is None:
            cur[0] = float(num.group(1))
        elif text.startswith("signal:") and cur[1] is None:
            cur[1] = float(num.group(1))
    return {k: (v[0], v[1]) for k, v in out.items()}


def band_of(freq_mhz: float | None, chan: str = "") -> str:
    """Frekanstan bant ('2.4' / '5' / '6'); frekans yoksa kanal numarasından (1–14 → 2,4; 32–177 → 5), yoksa '?'."""
    if freq_mhz:
        if 2400 <= freq_mhz < 2500:
            return "2.4"
        if 5150 <= freq_mhz < 5925:
            return "5"
        if 5925 <= freq_mhz < 7125:
            return "6"
    if str(chan).isdigit():
        c = int(chan)
        return "2.4" if 1 <= c <= 14 else "5" if 32 <= c <= 177 else "?"
    return "?"


def percent_to_dbm(percent: int | None) -> float | None:
    """NetworkManager yüzdesinden dBm tahmini (NM: dBm −100…−40 → %0…100 doğrusal; tersi). Kaba: %0 ve %100 kenarları kırpılmış."""
    if percent is None:
        return None
    return round(-40.0 - (100 - max(0, min(100, int(percent)))) * 0.6, 1)


def attach_dbm(rows: list[dict], iw: dict[str, tuple[float | None, float | None]]) -> None:
    """Erişim noktası satırlarına rssi (dBm), rssi_est (yüzdeden tahmin mi) ve band ekler (nmcli FREQ: '2462 MHz')."""
    for row in rows:
        freq_txt = _NUM_RE.search(str(row.get("freq") or ""))
        freq = float(freq_txt.group(1)) if freq_txt else None
        got = iw.get(str(row.get("addr") or "").upper())
        if got and got[1] is not None:
            row["rssi"], row["rssi_est"] = round(got[1]), False
            freq = freq or got[0]
        else:
            row["rssi"], row["rssi_est"] = percent_to_dbm(row.get("signal")), True
        row["band"] = band_of(freq, row.get("chan") or "")


def _loggable(row: dict) -> bool:
    if not row.get("addr") or row.get("rssi") is None:
        return False
    return row.get("kind") == "wifi" or (row.get("kind") in ("client", "probe") and not row.get("random"))


def record(board_id: int, rows: list[dict]) -> None:
    """Satırların sinyalini sensörün günlük toplamına ekler (aynı taramada aynı adres×bant bir kez — en güçlüsü)."""
    global _last_prune
    best: dict[tuple[str, str], dict] = {}
    for row in rows:
        if not _loggable(row):
            continue
        band = row.get("band") or band_of(None, row.get("chan") or "")
        key = (row["addr"].upper(), band)
        if key not in best or row["rssi"] > best[key]["rssi"]:
            best[key] = dict(row, band=band)
    if not best:
        return
    items = list(best.values())
    try:
        with db.connect() as conn:
            conn.execute(
                """INSERT INTO wifimon_signal_stats AS s (addr, board_id, band, kind, n, n_est, sum_dbm, sum_sq_dbm,
                                                          min_dbm, max_dbm, last_dbm, last_chan)
                   SELECT a, %s, b, k, 1, CASE WHEN e THEN 1 ELSE 0 END, d, d * d, d, d, d, c
                   FROM unnest(%s::text[], %s::text[], %s::text[], %s::float8[], %s::bool[], %s::text[]) AS u(a, b, k, d, e, c)
                   ON CONFLICT (addr, board_id, band, day) DO UPDATE SET
                     n = s.n + 1, n_est = s.n_est + EXCLUDED.n_est,
                     sum_dbm = s.sum_dbm + EXCLUDED.sum_dbm, sum_sq_dbm = s.sum_sq_dbm + EXCLUDED.sum_sq_dbm,
                     min_dbm = least(s.min_dbm, EXCLUDED.min_dbm), max_dbm = greatest(s.max_dbm, EXCLUDED.max_dbm),
                     last_dbm = EXCLUDED.last_dbm, last_chan = EXCLUDED.last_chan, kind = EXCLUDED.kind, last_at = now()""",
                (board_id, [r["addr"].upper() for r in items], [r["band"] for r in items], [r["kind"] for r in items],
                 [float(r["rssi"]) for r in items], [bool(r.get("rssi_est")) for r in items],
                 [str(r.get("chan") or "") for r in items]))
            if time.time() - _last_prune > 3600:
                _last_prune = time.time()
                conn.execute("DELETE FROM wifimon_signal_stats WHERE day < current_date - %s", (_RETENTION_DAYS,))
    except Exception as exc:  # kayıt yazılamazsa izleme sürer
        log.warning("wifimon_signal_stats yazılamadı: %s", exc)
