# pam_etap.py (pardus-etap-settings) session yığınında olduğu halde pam_sm_open/close_session tanımlamaz;
# pam_python her girişte bunu authpriv.err olarak basar. Kural /etc/rsyslog.d/*.conf'un yerel dosya kurallarından
# ÖNCE okunmasına dayanır (Debian rsyslog.conf: $IncludeConfig, ardından auth.log vb.) → iletim + yerel dosya ikisi de.
set -eu

CONF=/etc/rsyslog.d/89-tihamon-pam-noise.conf
command -v rsyslogd >/dev/null 2>&1 || { echo "Tahtada rsyslog yok; süzülecek bir şey yok."; exit 0; }

if [ "${MODE:-on}" = off ]; then
    [ -f "$CONF" ] || { echo "Süzgeç zaten yok."; exit 0; }
    rm -f "$CONF"
    systemctl restart rsyslog
    echo "Süzgeç kaldırıldı; pam_sm_*_session satırları yeniden kaydedilip iletilecek."
    exit 0
fi

BACKUP=
[ -f "$CONF" ] && BACKUP=$(mktemp) && cp -p "$CONF" "$BACKUP"
cat > "$CONF" <<'CONF_EOF'
# Tiha-Mon: Pardus pam_etap.py gürültüsü (zararsız; her SSH/oturum girişinde 2 satır).
# Kaldırmak için bu dosyayı silip rsyslog'u yeniden başlatın ya da Tiha-Mon'da "PAM log gürültüsünü süz → Süzmeyi kaldır".
if $msg contains "pam_sm_open_session() isn't defined" or $msg contains "pam_sm_close_session() isn't defined" then stop
CONF_EOF
chmod 644 "$CONF"

# Bozuk yapılandırma rsyslog'u (ve tüm kayıtları) durdurur: doğrula, olmadıysa eskiye dön. Dosya TEK başına
# doğrulanır: TiHA'nın 90-tiha-remote.conf'u rsyslog 8.2302'de bilinmeyen action.resumeintervalmultiplier
# içerdiğinden tam `rsyslogd -N1` zaten hata verir (rsyslog onu yok sayıp çalışır).
CHECK=$(mktemp)
printf 'include(file="%s")\naction(type="omfile" file="/dev/null")\n' "$CONF" > "$CHECK"
OK=1
rsyslogd -N1 -f "$CHECK" >/dev/null 2>&1 || OK=0
rm -f "$CHECK"
if [ "$OK" = 0 ]; then
    if [ -n "$BACKUP" ]; then cp -p "$BACKUP" "$CONF"; else rm -f "$CONF"; fi
    echo "Süzgeç doğrulanamadı; önceki duruma dönüldü." >&2
    exit 1
fi
[ -n "$BACKUP" ] && rm -f "$BACKUP"

systemctl restart rsyslog
systemctl is-active --quiet rsyslog
echo "Süzgeç etkin: pam_sm_open/close_session satırları artık kaydedilmiyor ve iletilmiyor."
