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

"""Ağ etkinliği: IP ID örneklemesiyle cihazın kabaca gönderdiği paket/sn (bkz. bellek network-usage-study).

İki tur ICMP echo gönderilir; yanıtların IP başlığındaki IP ID alanının iki tur arasındaki artışı,
cihazın o sürede HERKESE gönderdiği paket sayısıdır (IP ID her giden pakette artar). Windows tek, global
bir sayaç kullandığından güvenilir; Linux/kamera/router ID'yi geçen süreyle orantılı RASTGELE artırır ve
sahte (yüksek) değer verir — bu yüzden çağıran yalnız Windows cihazları örneklemelidir
(bkz. store.activity_targets: os_guess ILIKE '%windows%'). Raw ICMP soketi (root) gerekir; netscan zaten
root çalışır (arp-scan/nmap da raw soket kullanır).

Tek bir soketle TOPLU çalışır: tüm hedeflere 1. tur gönderilir, kısa süre yanıt toplanır, `gap` beklenir,
2. tur gönderilip toplanır. Böylece N cihaz için toplam süre ~gap'tir (cihaz başına değil).
"""

from __future__ import annotations

import logging
import os
import select
import socket
import struct
import time

log = logging.getLogger("ankamon.netscan")

# İki tur arası bundan büyük IP ID artışı sayaç sıfırlanması/taşmadır (uyku-uyanma); güvenilmez sayılır.
_RESET_JUMP = 8192


def _checksum(data: bytes) -> int:
    if len(data) % 2:
        data += b"\x00"
    total = sum(struct.unpack("!%dH" % (len(data) // 2), data))
    total = (total >> 16) + (total & 0xFFFF)
    total += total >> 16
    return (~total) & 0xFFFF


def _echo(ident: int) -> bytes:
    body = b"ankamon-activity"
    head = struct.pack("!BBHHH", 8, 0, 0, ident, 1)
    return struct.pack("!BBHHH", 8, 0, _checksum(head + body), ident, 1) + body


def sample_many(ips: list[str], gap: float = 4.0, window: float = 1.0) -> dict[str, float | None]:
    """{ip: pps} — her IP için kaba paket/sn; ölçülemeyen/güvenilmez için None.

    pps = (2. tur IP ID − 1. tur IP ID) / geçen süre. Yanıt vermeyen ya da sıfırlanan cihaz None olur.
    """
    if not ips:
        return {}
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_RAW, socket.IPPROTO_ICMP)
    except OSError as exc:
        log.error("ağ etkinliği: raw soket açılamadı (root gerekir): %s", exc)
        return {}
    ident = os.getpid() & 0xFFFF
    pkt = _echo(ident)

    def send_round() -> None:
        for ip in ips:
            try:
                sock.sendto(pkt, (ip, 0))
            except OSError:
                pass

    def collect() -> dict[str, int]:
        """`window` sn boyunca gelen echo-reply'lerin IP ID'leri: {ip: ip_id}."""
        got: dict[str, int] = {}
        end = time.monotonic() + window
        while True:
            left = end - time.monotonic()
            if left <= 0:
                break
            readable, _, _ = select.select([sock], [], [], left)
            if not readable:
                break
            try:
                data, addr = sock.recvfrom(2048)
            except OSError:
                break
            ihl = (data[0] & 0x0F) * 4
            if len(data) < ihl + 8 or data[ihl] != 0:  # ICMP echo reply (type 0) değil
                continue
            if struct.unpack("!H", data[ihl + 4:ihl + 6])[0] != ident:  # bizim ping'imiz değil
                continue
            got[addr[0]] = struct.unpack("!H", data[4:6])[0]  # IP başlığı 4-6: IP ID (identification)
        return got

    try:
        send_round()
        first = collect()
        t1 = time.monotonic()
        time.sleep(gap)
        send_round()
        second = collect()
        dt = time.monotonic() - t1
    finally:
        sock.close()

    out: dict[str, float | None] = {}
    for ip in ips:
        if ip in first and ip in second and dt > 0:
            delta = (second[ip] - first[ip]) % 65536
            out[ip] = None if delta > _RESET_JUMP else round(delta / dt, 1)
        else:
            out[ip] = None
    return out
