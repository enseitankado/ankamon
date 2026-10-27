#!/bin/sh
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

# HTTPS sertifikaları (nginx.sh her açılışta çağırır). Tarayıcının ekran yakalama API'si
# (getDisplayMedia — "Ekranımı yansıt") yalnız güvenli bağlamda (HTTPS) çalışır; okulda alan adı ve
# genel bir CA olmadığından Ankamon kendi yerel CA'sını üretir:
#   /data/tls/ca.crt + ca.key       — bir kez üretilir, kalıcıdır (10 yıl). Yönetici bilgisayarına bir
#                                     kez "güvenilen kök" olarak kurulursa tarayıcı uyarısı hiç çıkmaz;
#                                     http://<sunucu>/ankamon-ca.crt adresinden indirilir.
#   /data/tls/server.crt + .key     — CA ile imzalı; konu alternatif adları (SAN) sunucunun o anki IP'leri
#                                     + ana makine adı. Ağ segmenti değişince (IP listesi farklıysa) ya da
#                                     süresi 30 günden az kaldıysa kendiliğinden yeniden üretilir; CA aynı
#                                     kaldığından tarayıcılarda yeniden bir şey yapmak gerekmez.
set -eu

DIR=/data/tls
mkdir -p "$DIR"
chmod 755 "$DIR"
umask 077

if [ ! -s "$DIR/ca.key" ] || [ ! -s "$DIR/ca.crt" ]; then
    openssl req -x509 -newkey rsa:3072 -nodes -sha256 -days 3650 \
        -keyout "$DIR/ca.key" -out "$DIR/ca.crt" \
        -subj "/O=Ankamon/CN=Ankamon Yerel CA ($(hostname))" \
        -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
        -addext "keyUsage=critical,keyCertSign,cRLSign" >/dev/null 2>&1
    rm -f "$DIR/server.crt"
    echo "tls: yeni yerel CA üretildi ($DIR/ca.crt)"
fi
chmod 644 "$DIR/ca.crt"

# Host ağındayız (network_mode: host): arayüz adresleri gerçek LAN adresleridir.
ips=$(ip -4 -o addr show 2>/dev/null | awk '{ split($4, a, "/"); print a[1] }' | sort -u)
host=$(hostname)
# <ad>.local: istemciler sunucuya çoğunlukla mDNS adıyla (ör. https://okul-sunucu.local) ulaşır — SAN'da
# yoksa tarayıcı sertifikayı o ada ait saymaz (NET::ERR_CERT_COMMON_NAME_INVALID). <ad>.localhost:
# sunucunun kendi masaüstündeki tarayıcı (tarayıcılar *.localhost'u her zaman 127.0.0.1'e çözer).
sans="DNS:localhost,DNS:$host,DNS:$host.local,DNS:$host.localhost"
for ip in $ips; do sans="$sans,IP:$ip"; done

renew=
[ -s "$DIR/server.crt" ] && [ -s "$DIR/server.key" ] || renew="yok"
[ -n "$renew" ] || [ "$(cat "$DIR/server.sans" 2>/dev/null)" = "$sans" ] || renew="adresler değişti"
[ -n "$renew" ] || openssl x509 -in "$DIR/server.crt" -noout -checkend 2592000 >/dev/null 2>&1 || renew="süresi doluyor"

if [ -n "$renew" ]; then
    openssl req -new -newkey rsa:2048 -nodes -sha256 \
        -keyout "$DIR/server.key.new" -out "$DIR/server.csr" \
        -subj "/O=Ankamon/CN=$host" >/dev/null 2>&1
    printf 'subjectAltName=%s\nbasicConstraints=CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n' \
        "$sans" > "$DIR/server.ext"
    # 825 gün: tarayıcıların el ile kurulan kökler için de kabul ettiği üst sınır (macOS/iOS kuralı).
    openssl x509 -req -sha256 -days 825 -in "$DIR/server.csr" \
        -CA "$DIR/ca.crt" -CAkey "$DIR/ca.key" -CAcreateserial -CAserial "$DIR/ca.srl" \
        -extfile "$DIR/server.ext" -out "$DIR/server.crt.new" >/dev/null 2>&1
    mv "$DIR/server.key.new" "$DIR/server.key"
    mv "$DIR/server.crt.new" "$DIR/server.crt"
    printf '%s' "$sans" > "$DIR/server.sans"
    rm -f "$DIR/server.csr" "$DIR/server.ext"
    echo "tls: sunucu sertifikası üretildi ($renew): $sans"
fi
