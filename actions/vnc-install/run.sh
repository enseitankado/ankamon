# SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

# Ekran istemcisi (x11vnc) kurulumu (bkz. action.json). Ekranlar sekmesi, x11vnc yoksa bunu ayara
# bağlı olarak kendiliğinden çalıştırır (bkz. worker/ankamon/screen/__main__.py). Eski "x11VNC kur"
# (screen-share) işleminin sshd/servis adımları da buradadır; o işlem kaldırıldı.
set -u
export DEBIAN_FRONTEND=noninteractive

if command -v x11vnc >/dev/null 2>&1; then
    echo "x11vnc zaten kurulu ($(dpkg-query -W -f='${Version}' x11vnc 2>/dev/null || echo 'sürüm bilinmiyor'))."
else
    # Başka bir apt/dpkg (ör. otomatik güncelleme) çalışıyorsa kilit 10 dk'ya kadar beklenir; soru sorulmaz.
    APT=(apt-get -y -q -o DPkg::Lock::Timeout=600 -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold)

    echo "x11vnc kuruluyor…"
    if ! "${APT[@]}" install --no-install-recommends x11vnc; then
        # Paket listesi eski olabilir (paket bulunamadı / sürüm artık depoda yok): yenileyip bir kez daha.
        echo "Paket listeleri yenilenip yeniden deneniyor (apt update)…"
        "${APT[@]}" update || echo "Uyarı: bazı paket depolarına ulaşılamadı."
        if ! "${APT[@]}" install --no-install-recommends x11vnc; then
            echo "HATA: x11vnc kurulamadı (paket deposuna erişimi ve disk alanını denetleyin)." >&2
            exit 1
        fi
    fi
    if ! command -v x11vnc >/dev/null 2>&1; then
        echo "HATA: kurulum bitti ama x11vnc bulunamadı." >&2
        exit 1
    fi
    echo "x11vnc kuruldu: $(dpkg-query -W -f='${Version}' x11vnc 2>/dev/null)"
fi

# Paket kendi başına bir servis başlatmaz/etkinleştirmez; yine de emin olunur (ağa açık port olmasın).
systemctl disable --now x11vnc.service >/dev/null 2>&1 || true

# Ankamon x11vnc'ye "ssh -W 127.0.0.1:<port>" tüneliyle bağlanır; sshd'de TCP yönlendirme gerekir.
if [ "$(sshd -T 2>/dev/null | awk '/^allowtcpforwarding /{print $2}')" = "no" ]; then
    echo "AllowTcpForwarding local" > /etc/ssh/sshd_config.d/90-ankamon-screen.conf
    if sshd -t; then
        systemctl reload ssh 2>/dev/null || systemctl reload sshd
    else
        rm -f /etc/ssh/sshd_config.d/90-ankamon-screen.conf
        echo "sshd yapılandırması doğrulanamadı; değişiklik geri alındı." >&2
        exit 1
    fi
    echo "sshd: yerel TCP yönlendirme açıldı (/etc/ssh/sshd_config.d/90-ankamon-screen.conf)."
fi
