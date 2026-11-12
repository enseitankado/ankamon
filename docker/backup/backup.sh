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

# Rutin yedekleme döngüsü — plan Sistem ▸ Yedekler'den yönetilir (settings.backup_policy; her turda policy.py okur).
#   config-*.dump   : logs/metrics verisi hariç her şey (kullanıcılar, cihazlar, ayarlar); N saatte bir.
#   grafana-*.dump  : Grafana veritabanı; yapılandırma yedeğiyle birlikte alınır, aynı sayıda saklanır.
#   full-*.dump     : loglar ve sensör verisi dahil tam veritabanı yedeği; günde bir, belirlenen saatte.
#   files-*.tar.gz  : /data altındaki dosya depoları (TLS anahtarları, dosya yöneticisi, araçlar, ekran görüntüleri…);
#                     files-exclude.conf'takiler hariç — yeni açılan /data dizini kendiliğinden girer. Günde bir.
# Ev dizini yedeklerinin (/data/home-backups, "Yedekle/Geri al") saklama süresi de burada uygulanır (saatte bir).
# "Şimdi al" istekleri settings.backup_run'dan okunur (backend Api\BackupsApi::run). Son sonuçlar
# /run/ankamon/backup-status.json'a yazılır. Dosyalar önce .tmp olarak yazılır, diske eşitlenip yeniden adlandırılır:
# yarıda kesilen yedek geçerli görünmez.
set -u

DIR="${BACKUP_DIR:-/backups}"
HERE=$(dirname "$0")
STATUS=/run/ankamon/backup-status.json
HOME_BACKUPS=/data/home-backups
mkdir -p "$DIR"

log() { echo "$(date '+%F %T') $*"; }

sql() { psql -d ankamon -X -Atq -c "$1" 2>/dev/null; }

read_policy() {
    eval "$(sql "SELECT value::text FROM settings WHERE key = 'backup_policy'" | python3 "$HERE/policy.py")"
}

# Tür başına son sonuç: <tür>_AT (epoch), <tür>_OK (1/0), <tür>_MSG; çalışan tür RUNNING.
RUNNING=""
for k in config full files home; do eval "${k}_AT=0 ${k}_OK=1 ${k}_MSG=''"; done

json_str() { printf '%s' "$1" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()), end="")'; }

write_status() {
    {
        printf '{"updated":%s,"running":%s' "$(date +%s)" "$(json_str "$RUNNING")"
        for k in config full files home; do
            eval "at=\$${k}_AT ok=\$${k}_OK msg=\$${k}_MSG"
            printf ',"%s":{"at":%s,"ok":%s,"message":%s}' "$k" "$at" "$([ "$ok" = 1 ] && echo true || echo false)" "$(json_str "$msg")"
        done
        printf '}\n'
    } > "$STATUS.tmp" && chmod 644 "$STATUS.tmp" && mv "$STATUS.tmp" "$STATUS"
}

result() { # result <tür> <1|0> <ileti>
    eval "${1}_AT=$(date +%s) ${1}_OK=$2"
    eval "${1}_MSG=\$3"
}

dump() { # dump <çıktı dosyası> <veritabanı> [pg_dump seçenekleri…]
    out=$1; db=$2; shift 2
    if pg_dump -Fc -Z 6 -d "$db" "$@" -f "$out.tmp" 2>/tmp/pg_dump.err; then
        sync "$out.tmp" 2>/dev/null || sync
        mv "$out.tmp" "$out"
        log "tamam: $(basename "$out") ($(du -h "$out" | cut -f1))"
    else
        ERR="$(basename "$out") alınamadı: $(tail -n 3 /tmp/pg_dump.err | tr '\n' ' ')"
        log "HATA: $ERR"
        rm -f "$out.tmp"
        return 1
    fi
}

prune() { # prune <önek> <saklanacak adet> <uzantı>
    ls -1t "$DIR"/"$1"-*."$3" 2>/dev/null | tail -n +$(($2 + 1)) | while read -r f; do
        rm -f "$f" && log "silindi: $(basename "$f")"
    done
}

newest() { # newest <önek> <uzantı> → en yeni dosyanın epoch zamanı (yoksa 0)
    f=$(ls -1t "$DIR"/"$1"-*."$2" 2>/dev/null | head -n 1)
    if [ -n "$f" ]; then stat -c %Y "$f"; else echo 0; fi
}

run() { # run <tür> — yedeği alır, sonucu kaydeder; başarıda 0 döner
    RUNNING=$1; write_status
    ERR=""
    rm -f /tmp/backup.msg
    if "${1}_backup"; then
        result "$1" 1 "$(cat /tmp/backup.msg 2>/dev/null)"
        rc=0
    else
        result "$1" 0 "${ERR:-bilinmeyen hata}"
        rc=1
    fi
    RUNNING=""; write_status
    return $rc
}

config_backup() {
    ts=$(date +%Y%m%d-%H%M%S)
    # Hypertable verisi _timescaledb_internal şemasındaki parçalarda durur; onları dışarıda bırakmak yeter.
    dump "$DIR/config-$ts.dump" ankamon --exclude-table-data='_timescaledb_internal.*' || return 1
    dump "$DIR/grafana-$ts.dump" grafana || return 1
    prune config "$CONFIG_KEEP" dump
    prune grafana "$CONFIG_KEEP" dump
    echo "config-$ts.dump + grafana-$ts.dump" > /tmp/backup.msg
}

full_backup() {
    ts=$(date +%Y%m%d-%H%M%S)
    dump "$DIR/full-$ts.dump" ankamon || return 1
    prune full "$FULL_KEEP" dump
    echo "full-$ts.dump" > /tmp/backup.msg
}

# /data'nın dosya yedeğine girecek alt dizinleri (files-exclude.conf'takiler hariç; gizli dizinler dahil).
files_dirs() {
    for d in /data/* /data/.[!.]*; do
        [ -d "$d" ] || continue
        n=$(basename "$d")
        grep -q "^$n	" "$HERE/files-exclude.conf" 2>/dev/null && continue
        echo "$n"
    done
}

files_backup() {
    ts=$(date +%Y%m%d-%H%M%S)
    out="$DIR/files-$ts.tar.gz"
    list=$(files_dirs)
    if [ -z "$list" ]; then
        ERR="yedeklenecek dosya deposu yok"
        return 1
    fi
    # shellcheck disable=SC2086
    if tar -czf "$out.tmp" -C /data $list 2>/tmp/tar.err; then
        sync "$out.tmp" 2>/dev/null || sync
        mv "$out.tmp" "$out"
        log "tamam: $(basename "$out") ($(du -h "$out" | cut -f1)): $(echo $list)"
    else
        ERR="files-$ts.tar.gz alınamadı: $(tail -n 3 /tmp/tar.err | tr '\n' ' ')"
        log "HATA: $ERR"
        rm -f "$out.tmp"
        return 1
    fi
    prune files "$FILES_KEEP" tar.gz
    echo "files-$ts.tar.gz ($(echo $list))" > /tmp/backup.msg
}

# Ev dizini yedekleri: saklama süresini aşan görev dizinleri (worker executor/backup.py cleanup yalnız yeni yedek
# alınırken temizler; burada saatte bir). Yalnız HOME_BACKUPS altındaki job-<sayı> dizinleri.
home_backup() {
    n=0
    now=$(date +%s)
    for d in "$HOME_BACKUPS"/job-*; do
        [ -d "$d" ] || continue
        case "$(basename "$d")" in job-[0-9]*) ;; *) continue ;; esac
        if [ $((now - $(stat -c %Y "$d"))) -gt $((HOME_KEEP_HOURS * 3600)) ]; then
            rm -r -f -- "$d" && n=$((n + 1))
        fi
    done
    [ "$n" -gt 0 ] && log "ev dizini yedekleri: $n eski görev dizini silindi (${HOME_KEEP_HOURS} saatten eski)"
    echo "$n eski görev dizini silindi (${HOME_KEEP_HOURS} saatten eski)" > /tmp/backup.msg
}

# Yedekler sekmesinin okuduğu özet (/run/ankamon/backups.json; silen storage-ops servisi de aynı betiği çağırır).
write_summary() { sh "$HERE/summary.sh"; }

rm -f "$DIR"/*.tmp
config_AT=$(newest config dump)
full_AT=$(newest full dump)
files_AT=$(newest files tar.gz)
last_full_day=""
[ "$full_AT" -gt 0 ] && last_full_day=$(date -d "@$full_AT" +%Y%m%d)
last_files_day=""
[ "$files_AT" -gt 0 ] && last_files_day=$(date -d "@$files_AT" +%Y%m%d)
last_home=0
read_policy
log "yedekleme başladı (yapılandırma: ${CONFIG_EVERY} saatte bir, tam: her gün ${FULL_AT}, dosyalar: her gün ${FILES_AT})"
write_status
tick=0
while true; do
    read_policy
    # "Şimdi al" istekleri (Sistem ▸ Yedekler): settings.backup_run = {"kinds": [...]} — okunurken silinir.
    kinds=$(sql "DELETE FROM settings WHERE key = 'backup_run' RETURNING value::text" | python3 -c '
import json, sys
t = sys.stdin.read().strip()
kinds = (json.loads(t).get("kinds") or []) if t else []
print(" ".join(k for k in kinds if k in ("config", "full", "files", "home")))' 2>/dev/null)
    for k in $kinds; do
        log "elle istenen yedek: $k"
        run "$k"
        case $k in full) last_full_day=$(date +%Y%m%d) ;; files) last_files_day=$(date +%Y%m%d) ;; esac
        write_summary
    done
    if [ $((tick % 6)) -eq 0 ]; then
        now=$(date +%s)
        today=$(date +%Y%m%d)
        if [ "$CONFIG_ON" = 1 ] && [ $((now - config_AT)) -ge $((CONFIG_EVERY * 3600)) ]; then
            run config   # hata da zamanı ilerletir (result): sonraki deneme bir aralık sonra, sonuç panelde
        fi
        # Sunucu o saatte kapalıysa açıldığında telafi edilir.
        if [ "$FULL_ON" = 1 ] && [ "$today" != "$last_full_day" ] && [ "$(date +%H:%M)" \> "$FULL_AT" ]; then
            run full
            last_full_day=$today
        fi
        if [ "$FILES_ON" = 1 ] && [ "$today" != "$last_files_day" ] && [ "$(date +%H:%M)" \> "$FILES_AT" ]; then
            run files
            last_files_day=$today
        fi
        if [ $((now - last_home)) -ge 3600 ]; then
            run home
            last_home=$now
        fi
        write_summary
    fi
    tick=$((tick + 1))
    sleep 10
done
