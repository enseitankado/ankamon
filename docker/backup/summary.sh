#!/bin/sh
# Yedek dosyalarının özeti → /run/ankamon/backups.json. Yedek dizini bilerek root'a özel (700 —
# dökümlerde parola özetleri var) olduğundan PHP (nobody) dizini okuyamaz; içerik yerine yalnız
# ad/boyut/zaman listesi herkesin okuyabileceği bir dosyaya yazılır (bkz. backend DashboardApi::backups,
# BackupStatsApi). Çağıranlar: backup.sh (her tur) ve storage-ops.sh (yedek sildikten sonra).
set -u

DIR="${BACKUP_DIR:-/data/backups}"
SUMMARY=/run/ankamon/backups.json

{
    printf '{"updated":%s,"dir":"%s","keep_full":%s,"keep_config":%s,"full_at":"%s","config_every_hours":%s,"files":[' \
        "$(date +%s)" "$DIR" "${BACKUP_KEEP_FULL:-0}" "${BACKUP_KEEP_CONFIG:-0}" "${BACKUP_FULL_AT:-}" "${BACKUP_CONFIG_EVERY_HOURS:-0}"
    sep=""
    for f in "$DIR"/*.dump; do
        [ -f "$f" ] || continue
        set -- $(stat -c '%s %Y' "$f")
        printf '%s{"name":"%s","bytes":%s,"mtime":%s}' "$sep" "$(basename "$f")" "$1" "$2"
        sep=","
    done
    printf ']}\n'
} > "$SUMMARY.tmp" && chmod 644 "$SUMMARY.tmp" && mv "$SUMMARY.tmp" "$SUMMARY"
