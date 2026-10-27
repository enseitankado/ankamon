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

# Rutin yedekleme döngüsü.
#   config-*.dump : logs/metrics verisi hariç her şey (kullanıcılar, tahtalar, ayarlar) + Grafana; sık alınır, küçüktür.
#   full-*.dump   : loglar ve sensör verisi dahil tam yedek; günde bir.
# Dosyalar önce .tmp olarak yazılır, diske eşitlenip yeniden adlandırılır: yarıda kesilen yedek geçerli görünmez.
set -u

DIR="${BACKUP_DIR:-/backups}"
mkdir -p "$DIR"

log() { echo "$(date '+%F %T') $*"; }

dump() { # dump <çıktı dosyası> <veritabanı> [pg_dump seçenekleri…]
    out=$1; db=$2; shift 2
    if pg_dump -Fc -Z 6 -d "$db" "$@" -f "$out.tmp" 2>/tmp/pg_dump.err; then
        sync "$out.tmp" 2>/dev/null || sync
        mv "$out.tmp" "$out"
        log "tamam: $(basename "$out") ($(du -h "$out" | cut -f1))"
    else
        log "HATA: $(basename "$out") alınamadı: $(tail -n 3 /tmp/pg_dump.err | tr '\n' ' ')"
        rm -f "$out.tmp"
        return 1
    fi
}

prune() { # prune <önek> <saklanacak adet>
    ls -1t "$DIR"/"$1"-*.dump 2>/dev/null | tail -n +$(($2 + 1)) | while read -r f; do
        rm -f "$f" && log "silindi: $(basename "$f")"
    done
}

config_backup() {
    ts=$(date +%Y%m%d-%H%M%S)
    # Hypertable verisi _timescaledb_internal şemasındaki parçalarda durur; onları dışarıda bırakmak yeter.
    dump "$DIR/config-$ts.dump" ankamon --exclude-table-data='_timescaledb_internal.*' || return 1
    dump "$DIR/grafana-$ts.dump" grafana || return 1
    prune config "$BACKUP_KEEP_CONFIG"
    prune grafana "$BACKUP_KEEP_CONFIG"
}

full_backup() {
    ts=$(date +%Y%m%d-%H%M%S)
    dump "$DIR/full-$ts.dump" ankamon || return 1
    prune full "$BACKUP_KEEP_FULL"
}

# Genel bakış'ın "Yedekler" kartı ve Disk kullanımı penceresi için özet (bkz. summary.sh — yedek
# silen storage-ops servisi de aynı betiği çağırır).
write_summary() { sh "$(dirname "$0")/summary.sh"; }

rm -f "$DIR"/*.tmp
last_config=0
last_full_day=$(ls -1t "$DIR"/full-*.dump 2>/dev/null | head -n 1 | sed -n 's/.*full-\([0-9]\{8\}\)-.*/\1/p')

log "yedekleme başladı (yapılandırma: ${BACKUP_CONFIG_EVERY_HOURS} saatte bir, tam: her gün ${BACKUP_FULL_AT})"
while true; do
    now=$(date +%s)
    if [ $((now - last_config)) -ge $((BACKUP_CONFIG_EVERY_HOURS * 3600)) ]; then
        config_backup && last_config=$now
    fi
    today=$(date +%Y%m%d)
    # Sunucu o saatte kapalıysa açıldığında telafi edilir.
    if [ "$today" != "$last_full_day" ] && [ "$(date +%H:%M)" \> "$BACKUP_FULL_AT" ]; then
        full_backup && last_full_day=$today
    fi
    write_summary
    sleep 60
done
