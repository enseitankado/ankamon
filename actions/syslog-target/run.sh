# TiHA m06 (Merkezi log sunucusu) ile aynı dosyayı aynı biçimde yazar; TiHA formu bu ayarı okuyabilir.
set -eu

# Adres verilmediyse: bu SSH bağlantısının geldiği adres, yani Tiha-Mon sunucusu.
HOST="${HOST:-${SSH_CONNECTION%% *}}"
[ -n "$HOST" ] || { echo "Log sunucusu adresi belirlenemedi." >&2; exit 2; }

case "${PROFILE:-bakim}" in
    kapsamli) SELECTORS='*.*' ;;
    guvenlik) SELECTORS='auth,authpriv.* kern.err daemon.err' ;;
    *) PROFILE=bakim
       SELECTORS='auth,authpriv.* kern.warning daemon.notice syslog.* local0,local1,local2,local3,local4,local5,local6,local7.*' ;;
esac
if [ "${PROTO:-tcp}" = udp ]; then REBIND='UDP.RebindInterval="60"'; else PROTO=tcp; REBIND='RebindInterval="60"'; fi

command -v rsyslogd >/dev/null 2>&1 || DEBIAN_FRONTEND=noninteractive apt-get install -y rsyslog
mkdir -p /var/lib/rsyslog
chown -R syslog:adm /var/lib/rsyslog 2>/dev/null || true

CONF=/etc/rsyslog.d/90-tiha-remote.conf
BACKUP=
[ -f "$CONF" ] && BACKUP=$(mktemp) && cp -p "$CONF" "$BACKUP"

{
    cat <<CONF_EOF
# TiHA - Dayanıklı merkezi log iletimi
# Profil: $PROFILE (Tiha-Mon tarafından yazıldı)
# TIHA_PROFILE=$PROFILE
#
# Uzak sunucu offline olduğunda loglar kaybolmaz - diskte sıralanır.
# Sunucu geri geldiğinde birikmiş loglar otomatik gönderilir.

\$CreateDirs on
\$Umask 0000

ruleset(name="tiha_remote"
        queue.filename="tiha_remote"
        queue.type="LinkedList"
        queue.saveonshutdown="on"
        queue.maxdiskspace="2g"
        queue.size="100000"
        queue.discardseverity="0"
        queue.checkpointinterval="10") {
    action(type="omfwd"
           target="$HOST"
           port="$PORT"
           protocol="$PROTO"
           $REBIND
           action.resumeretrycount="-1"
           action.resumeinterval="30"
           action.resumeintervalmultiplier="2"
           action.resumeintervalmax="600")
}

# Profile göre iletilen olaylar
CONF_EOF
    for selector in $SELECTORS; do
        printf '%-60s call tiha_remote\n' "$selector"
    done
} > "$CONF"
chmod 644 "$CONF"

# Bozuk yapılandırma rsyslog'u (ve yerel kayıtları) durdurur: doğrula, olmadıysa eskiye dön.
if ! rsyslogd -N1 >/dev/null 2>&1; then
    if [ -n "$BACKUP" ]; then cp -p "$BACKUP" "$CONF"; else rm -f "$CONF"; fi
    echo "Yeni yapılandırma doğrulanamadı; önceki duruma dönüldü." >&2
    exit 1
fi
[ -n "$BACKUP" ] && rm -f "$BACKUP"

systemctl restart rsyslog
systemctl is-active --quiet rsyslog
echo "Loglar $HOST:$PORT/$PROTO adresine gönderiliyor (profil: $PROFILE)."
