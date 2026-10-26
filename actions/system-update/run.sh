# Sistem güncelleme (bkz. action.json). Asıl iş tahtada ayrı bir systemd birimi olarak çalışır: SSH
# bağlantısı koparsa ya da görev zaman aşımına uğrarsa dpkg yarıda kesilmez (yarım kalan dpkg tahtayı
# açılmaz hâle getirebilir). Bu betik birimi başlatır ve çıktısını, birim bitene dek canlı izler.
set -eu
UNIT=ankamon-sistem-guncelle
DIR=/var/lib/ankamon
LOG=/var/log/ankamon-sistem-guncelle.log
RC="$DIR/sistem-guncelle.rc"
REBOOT="${REBOOT:-hayir}"
mkdir -p "$DIR"

if systemctl is-active --quiet "$UNIT"; then
    echo "Bu tahtada sistem güncellemesi zaten sürüyor — çıktısı izleniyor."
else
    cat > "$DIR/sistem-guncelle.sh" <<'INNER'
set -u
export DEBIAN_FRONTEND=noninteractive
# Çıkış kodu dosyaya yazılır: birim bittikten sonra izleyen betik sonucu buradan okur.
trap 'echo $? > /var/lib/ankamon/sistem-guncelle.rc' EXIT
# Kilit: başka bir apt/dpkg (ör. otomatik güncelleme) çalışıyorsa 10 dk'ya kadar beklenir.
# Ayar dosyaları: yerel değişiklik varsa korunur (confold), yoksa paketin yenisi alınır (confdef) — soru sorulmaz.
APT=(apt-get -y -q -o DPkg::Lock::Timeout=600 -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold)
step() { echo; echo "== $*"; }
warn=0

echo "Sistem güncelleme başladı: $(date '+%d.%m.%Y %H:%M:%S') · $(. /etc/os-release; echo "$PRETTY_NAME")"
echo "Disk (/): $(df -h / | awk 'NR == 2 {print $4 " boş / " $2}')"

step "Yarım kalmış kurulumlar tamamlanıyor (dpkg --configure -a)"
dpkg --force-confdef --force-confold --configure -a || warn=1

step "Paket listeleri yenileniyor (apt update)"
"${APT[@]}" update || { echo "Uyarı: bazı paket depolarına ulaşılamadı; ulaşılanlarla devam ediliyor."; warn=1; }

step "Bozuk bağımlılıklar onarılıyor (apt -f install)"
"${APT[@]}" -f install || warn=1

n=$(apt-get -s full-upgrade 2>/dev/null | grep -c '^Inst' || true)
step "Paketler yükseltiliyor (apt full-upgrade) — $n paket"
if [ "$n" -gt 0 ]; then
    "${APT[@]}" full-upgrade || { echo "HATA: yükseltme tamamlanamadı."; exit 1; }
else
    echo "Tüm paketler güncel."
fi

step "Gereksiz paketler kaldırılıyor (apt autoremove --purge)"
"${APT[@]}" autoremove --purge || warn=1

step "Kaldırılmış paketlerin artık ayarları siliniyor"
leftover=$(dpkg -l | awk '/^rc/ {print $2}')
if [ -n "$leftover" ]; then
    echo "$leftover" | tr '\n' ' '; echo
    # shellcheck disable=SC2086
    dpkg --purge $leftover || warn=1
else
    echo "Yok."
fi

step "İndirilen paket dosyaları temizleniyor (apt clean)"
apt-get clean

if command -v flatpak >/dev/null 2>&1; then
    step "Flatpak uygulamaları güncelleniyor"
    flatpak update -y --noninteractive || warn=1
    flatpak uninstall -y --unused --noninteractive || warn=1
fi

step "Sonuç"
echo "Disk (/): $(df -h / | awk 'NR == 2 {print $4 " boş / " $2}')"
# Yeniden başlatma gereği: Debian'ın işaret dosyası ya da çalışan çekirdekten yeni bir çekirdek kurulmuş olması.
newest=$(ls /lib/modules 2>/dev/null | sort -V | tail -n 1)
if [ -f /run/reboot-required ] || { [ -n "$newest" ] && [ "$newest" != "$(uname -r)" ]; }; then
    echo "Yeniden başlatma gerekiyor (çalışan çekirdek $(uname -r), kurulu en yeni $newest)."
    if [ "${REBOOT:-hayir}" = evet ]; then
        shutdown -r +1 "Ankamon: sistem güncellemesi sonrası 1 dakika içinde yeniden başlatılıyor." \
            && echo "Tahta 1 dakika içinde yeniden başlatılacak."
    else
        echo "Yeniden başlatma seçilmedi — değişiklikler tahta yeniden açılınca tam etkinleşir."
    fi
else
    echo "Yeniden başlatma gerekmiyor."
fi
[ "$warn" = 0 ] && echo "Güncelleme tamamlandı." || echo "Güncelleme tamamlandı, ama yukarıda uyarılar var."
exit 0
INNER
    rm -f "$RC"
    : > "$LOG"
    systemctl reset-failed "$UNIT" >/dev/null 2>&1 || true
    systemd-run --quiet --unit="$UNIT" --collect \
        -p StandardOutput="append:$LOG" -p StandardError="append:$LOG" \
        --setenv=REBOOT="$REBOOT" /bin/bash "$DIR/sistem-guncelle.sh"
fi

# Çıktıyı birim bitene dek canlı izle (tail --pid: süreç bitince kalan satırları yazıp çıkar).
pid=$(systemctl show -p MainPID --value "$UNIT" 2>/dev/null || echo 0)
if [ "${pid:-0}" != 0 ]; then
    tail -n +1 -F --pid="$pid" "$LOG" 2>/dev/null
else
    cat "$LOG"
fi
# rc dosyası trap'ten hemen sonra yazılır; birim bitişiyle aynı anda okunursa diye kısa bir pay.
for _ in 1 2 3 4 5; do [ -s "$RC" ] && break; sleep 1; done
exit "$(cat "$RC" 2>/dev/null || echo 1)"
