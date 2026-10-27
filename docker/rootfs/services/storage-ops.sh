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

# Disk kullanımı penceresinin root yetkisi gerektiren kalıcı silmeleri (yedekler, rsyslog kuyruğu).
#
# PHP (nobody) bu dizinlere erişemez ve konteynerde sudo yoktur; bu yüzden API silinecekleri
# /run/ankamon/storage-ops/<kimlik>.req dosyasına yazar, bu döngü (root) 2 sn'de bir okur, adları KATI
# desenlerle doğrular (yalnız bilinen dosya/klasör adları — yol, joker kabul edilmez), siler ve silinen
# adedi <kimlik>.done'a yazar (bkz. backend Core\Storage::rootRequest). İstek biçimi:
#   1. satır: hedef — "backups" ya da "logqueue"
#   backups : satır başına dosya adı (config|full|grafana-YYYYMMDD-HHMMSS.dump), "*" (tümü) ya da
#             "<tür>:*" (o türün tümü, ör. "full:*")
#   logqueue: "live" (rsyslog'un bekleyen disk kuyruğu — rsyslog durdurulur, ankamon_pg.* silinir,
#             yeniden başlatılır; parça parça silmek kuyruğun konum dosyasını bozar) ya da
#             "bozuk-YYYYMMDD-HHMMSS" (rsyslog.sh'ın açılışta kenara aldığı bozuk kuyruk klasörü)
set -u

REQ=/run/ankamon/storage-ops
BACKUPS="${BACKUP_DIR:-/data/backups}"
SPOOL=/data/rsyslog

log() { echo "$(date '+%F %T') storage-ops: $*"; }

mkdir -p "$REQ" && chown nobody:nobody "$REQ" && chmod 700 "$REQ"
rm -f "$REQ"/*.req "$REQ"/*.done "$REQ"/*.tmp

# backups isteği: stdin'den adlar; silinen adedi basar.
delete_backups() {
    n=0
    while read -r name; do
        case "$name" in
            "*") glob="*" ;;
            full:\*|config:\*|grafana:\*) glob="${name%:*}-*" ;;
            *) glob="" ;;
        esac
        if [ -n "$glob" ]; then
            for f in "$BACKUPS"/$glob.dump; do
                [ -f "$f" ] && rm -f "$f" && n=$((n + 1)) && log "yedek silindi: $(basename "$f")" >&2
            done
            continue
        fi
        echo "$name" | grep -Eq '^(config|full|grafana)-[0-9]{8}-[0-9]{6}\.dump$' || continue
        [ -f "$BACKUPS/$name" ] && rm -f "$BACKUPS/$name" && n=$((n + 1)) && log "yedek silindi: $name" >&2
    done
    sh /opt/ankamon/backup/summary.sh
    echo "$n"
}

# logqueue isteği: stdin'den adlar; silinen dosya adedini basar.
delete_logqueue() {
    n=0
    while read -r name; do
        if [ "$name" = live ]; then
            set -- "$SPOOL"/ankamon_pg.*
            [ -e "$1" ] || continue
            # rsyslog SIGKILL ile durur (bkz. supervisord.conf) — kuyruk dosyalarını yazarken silinmesin.
            supervisorctl stop rsyslog >&2
            for f in "$SPOOL"/ankamon_pg.*; do
                [ -f "$f" ] && rm -f "$f" && n=$((n + 1))
            done
            supervisorctl start rsyslog >&2
            log "rsyslog bekleyen kuyruğu silindi ($n dosya)" >&2
            continue
        fi
        echo "$name" | grep -Eq '^bozuk-[0-9]{8}-[0-9]{6}$' || continue
        [ -d "$SPOOL/$name" ] || continue
        c=$(find "$SPOOL/$name" -type f | wc -l)
        rm -rf "${SPOOL:?}/$name" && n=$((n + c)) && log "bozuk kuyruk klasörü silindi: $name ($c dosya)" >&2
    done
    echo "$n"
}

while true; do
    for req in "$REQ"/*.req; do
        [ -f "$req" ] || continue
        target=$(head -n 1 "$req")
        case "$target" in
            backups) n=$(tail -n +2 "$req" | delete_backups) ;;
            logqueue) n=$(tail -n +2 "$req" | delete_logqueue) ;;
            *) n=0; log "bilinmeyen hedef: $target" ;;
        esac
        rm -f "$req"
        out="${req%.req}.done"
        echo "${n:-0}" > "$out.tmp" && chmod 644 "$out.tmp" && mv "$out.tmp" "$out"
    done
    sleep 2
done
