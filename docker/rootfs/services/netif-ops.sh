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

#
# Ayarlar ▸ Ağ arabirimleri: sunucunun ağ kartını kablo çıkarmadan ETKİN / PASİF yapma (kullanıcı isteği 2026-11-10).
#
# Konteyner host ağında çalışır (network_mode: host) ve NET_ADMIN yetkisiyle (docker-compose.yml cap_add) host'un kartını
# `ip link set dev <ad> up|down` ile açıp kapatır. PHP (nobody) bunu yapamaz; API isteği /run/ankamon/netif-ops/<kimlik>.req
# dosyasına yazar (1. satır: up|down, 2. satır: arabirim adı), bu döngü (root) okur, adı KATI doğrular (desen + host'ta var +
# Docker'ın kendi arabirimi değil), uygular ve sonucu <kimlik>.done'a yazar ("ok" ya da "hata: …").
# Pasif yapılan kartlar /data/netif/disabled'da saklanır: konteyner (ya da sunucu) yeniden başlayınca yine kapatılır —
# host'un ağ yöneticisi açılışta kartı açsa da Ankamon ayarı geçerli kalır. Bkz. backend Core\NetifControl, Api\SettingsApi.
set -u

REQ=/run/ankamon/netif-ops
STATE_DIR=/data/netif
STATE="$STATE_DIR/disabled"

log() { echo "$(date '+%F %T') netif-ops: $*"; }

mkdir -p "$REQ" && chown nobody:nobody "$REQ" && chmod 700 "$REQ"
rm -f "$REQ"/*.req "$REQ"/*.done "$REQ"/*.tmp
mkdir -p "$STATE_DIR" && touch "$STATE" && chmod 644 "$STATE"

valid() {
    echo "$1" | grep -Eq '^[A-Za-z0-9_.:@-]{1,15}$' || return 1
    case "$1" in lo|docker*|br-*|veth*) return 1 ;; esac
    [ -e "/sys/class/net/$1" ]
}

# Açılışta: kayıtlı pasif kartları yeniden kapat (yoksa — kart çıkarılmış — atla).
while read -r name; do
    [ -n "$name" ] && valid "$name" && ip link set dev "$name" down 2>/dev/null && log "pasif (kayıtlı): $name"
done < "$STATE"

while true; do
    for req in "$REQ"/*.req; do
        [ -f "$req" ] || continue
        action=$(sed -n 1p "$req")
        name=$(sed -n 2p "$req")
        rm -f "$req"
        result="ok"
        if ! valid "$name"; then
            result="hata: geçersiz ya da bulunamayan arabirim"
        elif [ "$action" = down ] || [ "$action" = up ]; then
            if out=$(ip link set dev "$name" "$action" 2>&1); then
                grep -vxF "$name" "$STATE" > "$STATE.tmp" || true
                [ "$action" = down ] && echo "$name" >> "$STATE.tmp"
                mv "$STATE.tmp" "$STATE" && chmod 644 "$STATE"
                log "$name: $action"
            else
                result="hata: $out"
                log "$name: $action başarısız: $out"
            fi
        else
            result="hata: bilinmeyen işlem"
        fi
        done_file="${req%.req}.done"
        printf '%s\n' "$result" > "$done_file.tmp" && chmod 644 "$done_file.tmp" && mv "$done_file.tmp" "$done_file"
    done
    sleep 1
done
