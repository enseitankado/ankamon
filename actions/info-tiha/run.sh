var() { [ -e "$2" ] && echo "[x] $1" || echo "[ ] $1"; }
svc() { systemctl is-enabled --quiet "$2" 2>/dev/null && echo "[x] $1" || echo "[ ] $1"; }
act() { systemctl is-active --quiet "$2" 2>/dev/null && echo "[x] $1" || echo "[ ] $1"; }

RS=/etc/rsyslog.d/90-tiha-remote.conf
if [ -f "$RS" ]; then
    echo "[x] Merkezi log: $(sed -n 's/.*target="\([^"]*\)".*/\1/p' "$RS" | head -n1):$(sed -n 's/.*port="\([^"]*\)".*/\1/p' "$RS" | head -n1)/$(sed -n 's/.*protocol="\([^"]*\)".*/\1/p' "$RS" | head -n1), profil $(sed -n 's/^# TIHA_PROFILE=//p' "$RS")"
    echo "    Bekleyen kuyruk dosyası: $(ls /var/lib/rsyslog/tiha_remote* 2>/dev/null | wc -l)"
else
    echo "[ ] Merkezi log"
fi
act "Metrik izleme (node_exporter) $(sed -n 's/.*--web.listen-address=\([^" ]*\).*/\1/p' /etc/default/prometheus-node-exporter 2>/dev/null)" prometheus-node-exporter
act "SSH sunucusu" ssh
act "Dosya sunucusu (Samba)" smbd
var "Zaman eşitleme ayarı" /etc/systemd/timesyncd.conf.d/tiha.conf
var "Dinamik bilgisayar adı" /etc/systemd/system/tiha-first-boot-hostname.service
svc "Uzaktan uyandırma (Wake-on-LAN)" tiha-wake-on-lan.service
svc "Açılışta parola temizliği" tiha-boot-password-wipe.service
var "Oturum kalıntısı temizliği" /etc/systemd/logind.conf.d/90-tiha-oturum-kalintilari.conf
var "Hafif mod" /etc/eta-light-mode/settings.json
var "PIN anahtarları" /etc/otp-secrets.json
var "GRUB koruması" /etc/grub.d/01_tiha_grub_password
svc "Otomatik Ahenk kaydı" tiha-clone-reclaim.service
act "Ahenk" ahenk
