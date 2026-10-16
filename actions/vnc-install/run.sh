# Ekran istemcisi (x11vnc) kurulumu (bkz. action.json). Ekranlar sekmesi, x11vnc yoksa bunu ayara
# bağlı olarak kendiliğinden çalıştırır (bkz. worker/tihamon/screen/__main__.py).
set -u
export DEBIAN_FRONTEND=noninteractive

if command -v x11vnc >/dev/null 2>&1; then
    echo "x11vnc zaten kurulu ($(dpkg-query -W -f='${Version}' x11vnc 2>/dev/null || echo 'sürüm bilinmiyor')) — değişiklik yapılmadı."
    exit 0
fi

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
