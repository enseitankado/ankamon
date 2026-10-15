set -eu
export DEBIAN_FRONTEND=noninteractive

if ! command -v x11vnc >/dev/null 2>&1; then
    apt-get update -q || echo "Uyarı: paket listesi güncellenemedi, mevcut listeyle deneniyor." >&2
    apt-get install -y x11vnc
fi
# Paket kendi başına bir servis başlatmaz/etkinleştirmez; yine de emin olunur.
systemctl disable --now x11vnc.service >/dev/null 2>&1 || true

# Tiha-Mon x11vnc'ye "ssh -W 127.0.0.1:<port>" tüneliyle bağlanır; sshd'de TCP yönlendirme gerekir.
if [ "$(sshd -T 2>/dev/null | awk '/^allowtcpforwarding /{print $2}')" = "no" ]; then
    echo "AllowTcpForwarding local" > /etc/ssh/sshd_config.d/90-tihamon-screen.conf
    if sshd -t; then
        systemctl reload ssh 2>/dev/null || systemctl reload sshd
    else
        rm -f /etc/ssh/sshd_config.d/90-tihamon-screen.conf
        echo "sshd yapılandırması doğrulanamadı; değişiklik geri alındı." >&2
        exit 1
    fi
    echo "sshd: yerel TCP yönlendirme açıldı (/etc/ssh/sshd_config.d/90-tihamon-screen.conf)."
fi

echo "x11vnc $(x11vnc -version 2>/dev/null | head -n 1 | awk '{print $2}') hazır — Tiha-Mon'da \"Ekranı göster\" kullanılabilir."
