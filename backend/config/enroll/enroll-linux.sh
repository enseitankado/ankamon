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

# Ankamon'a katılım betiği (Linux) — Ankamon sunucusu üretir (backend Api/EnrollApi.php), süreli kodla verilir.
# Yaptıkları: OpenSSH sunucusunu kurar ve açılışta başlar yapar; __ANKAMON_SSH_USER__ hesabının parolasını Ankamon'un
# Cihaz erişimi parolası yapar (betikte yalnız SHA-512 özeti var) ve SSH'de parolayla girişe izin verir; güvenlik
# duvarında 22/tcp'yi açar; sonunda cihazı Ankamon'a bildirir. Kod geçerlilik sonu: __ANKAMON_EXPIRES__
ANKAMON_URL='__ANKAMON_URL__'
SSH_USER='__ANKAMON_SSH_USER__'
HASH='__ANKAMON_HASH__'

say() { printf '%s\n' "$*"; }
step() { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }
ok() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
fail() { printf '\n\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
fetch() {
  if command -v curl >/dev/null 2>&1; then curl -fsSL "$1"; elif command -v wget >/dev/null 2>&1; then wget -qO- "$1"; else return 127; fi
}

# Betik `curl … | sh` ile stdin'den okunur: gövde işlevin içinde (sh önce tamamını okur), komutlar stdin'i yemesin diye
# </dev/null ile çalışır (apt-get vb. borudaki betiğin kalanını okuyabilirdi).
main() {
  say "Ankamon'a katılım — $(hostname 2>/dev/null)"

  # Yönetici yetkisi: root değilse betik sudo (yoksa su) ile yeniden çekilip çalıştırılır.
  if [ "$(id -u)" != 0 ]; then
    say "Yönetici (root) yetkisi gerekiyor."
    if command -v sudo >/dev/null 2>&1; then
      say "sudo parolanız sorulacak:"
      fetch "$ANKAMON_URL" | sudo sh
      exit $?
    fi
    say "sudo yok; root parolası sorulacak (su):"
    fetch "$ANKAMON_URL" > /tmp/ankamon-katilim.$$ && su -c "sh /tmp/ankamon-katilim.$$"; rc=$?
    rm -f /tmp/ankamon-katilim.$$
    exit $rc
  fi
  export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin LC_ALL=C.UTF-8 DEBIAN_FRONTEND=noninteractive

  step "1/5 OpenSSH sunucusu"
  if command -v sshd >/dev/null 2>&1 || [ -x /usr/sbin/sshd ]; then
    ok "zaten kurulu"
  else
    if command -v apt-get >/dev/null 2>&1; then
      apt-get install -y -q openssh-server >/dev/null 2>&1 || { apt-get update -q >/dev/null 2>&1; apt-get install -y -q openssh-server >/dev/null 2>&1; }
    elif command -v dnf >/dev/null 2>&1; then dnf install -y -q openssh-server >/dev/null 2>&1
    elif command -v yum >/dev/null 2>&1; then yum install -y -q openssh-server >/dev/null 2>&1
    elif command -v zypper >/dev/null 2>&1; then zypper -n -q install openssh-server >/dev/null 2>&1 || zypper -n -q install openssh >/dev/null 2>&1
    elif command -v pacman >/dev/null 2>&1; then pacman -S --noconfirm --needed openssh >/dev/null 2>&1
    elif command -v apk >/dev/null 2>&1; then apk add -q openssh >/dev/null 2>&1
    else fail "Paket yöneticisi bulunamadı; OpenSSH sunucusunu elle kurun ve betiği yeniden çalıştırın."
    fi
    { command -v sshd >/dev/null 2>&1 || [ -x /usr/sbin/sshd ]; } || fail "OpenSSH sunucusu kurulamadı (paket deposuna erişim gerekir)."
    ok "kuruldu"
  fi

  step "2/5 $SSH_USER parolası"
  id "$SSH_USER" >/dev/null 2>&1 || fail "Bu bilgisayarda '$SSH_USER' hesabı yok."
  usermod -p "$HASH" "$SSH_USER" 2>/dev/null || printf '%s:%s\n' "$SSH_USER" "$HASH" | chpasswd -e 2>/dev/null || fail "Parola ayarlanamadı."
  passwd -u "$SSH_USER" >/dev/null 2>&1
  ok "Ankamon'un Cihaz erişimi parolası ayarlandı"

  step "3/5 SSH ayarı (parolayla $SSH_USER girişi)"
  CFG=/etc/ssh/sshd_config
  if [ -f "$CFG" ] && grep -qiE '^[[:space:]]*Include[[:space:]]+/etc/ssh/sshd_config\.d/' "$CFG"; then
    mkdir -p /etc/ssh/sshd_config.d
    # sshd'de ilk geçen değer geçerlidir: 00- önce okunur.
    printf '# Ankamon katılım betiği — Ankamon SSH ile yönetir\nPermitRootLogin yes\nPasswordAuthentication yes\n' > /etc/ssh/sshd_config.d/00-ankamon.conf
    ok "/etc/ssh/sshd_config.d/00-ankamon.conf"
  elif [ -f "$CFG" ]; then
    cp -p "$CFG" "$CFG.ankamon-yedek" 2>/dev/null
    sed -i -E 's/^[[:space:]]*#?[[:space:]]*PermitRootLogin[[:space:]].*/PermitRootLogin yes/; s/^[[:space:]]*#?[[:space:]]*PasswordAuthentication[[:space:]].*/PasswordAuthentication yes/' "$CFG"
    grep -qE '^PermitRootLogin yes' "$CFG" || printf 'PermitRootLogin yes\n' >> "$CFG"
    grep -qE '^PasswordAuthentication yes' "$CFG" || printf 'PasswordAuthentication yes\n' >> "$CFG"
    ok "$CFG (yedek: $CFG.ankamon-yedek)"
  fi
  ssh-keygen -A >/dev/null 2>&1
  SSHD=$(command -v sshd || echo /usr/sbin/sshd)
  "$SSHD" -t 2>/dev/null || warn "sshd ayar denetimi uyarı verdi: $("$SSHD" -t 2>&1 | head -n 1)"

  step "4/5 SSH servisi"
  if command -v systemctl >/dev/null 2>&1; then
    for s in ssh sshd; do
      if systemctl list-unit-files "$s.service" 2>/dev/null | grep -q "^$s.service"; then
        systemctl enable "$s.service" >/dev/null 2>&1
        systemctl restart "$s.service" >/dev/null 2>&1 && { ok "$s.service çalışıyor, açılışta başlar"; break; }
      fi
    done
  elif command -v rc-service >/dev/null 2>&1; then
    rc-update add sshd default >/dev/null 2>&1; rc-service sshd restart >/dev/null 2>&1 && ok "sshd çalışıyor"
  else
    service ssh restart >/dev/null 2>&1 || service sshd restart >/dev/null 2>&1 || "$SSHD"
  fi
  if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
    ufw allow 22/tcp >/dev/null 2>&1 && ok "güvenlik duvarı (ufw): 22/tcp açıldı"
  fi
  if command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state >/dev/null 2>&1; then
    firewall-cmd -q --permanent --add-service=ssh && firewall-cmd -q --reload && ok "güvenlik duvarı (firewalld): ssh açıldı"
  fi
  if command -v ss >/dev/null 2>&1; then
    ss -ltn 2>/dev/null | grep -qE '[:.]22[[:space:]]' && ok "22. port dinleniyor" || warn "22. port dinlenmiyor görünüyor"
  fi

  step "5/5 Ankamon'a bildirim"
  macs=""
  for d in /sys/class/net/*; do
    n=${d##*/}; [ "$n" = lo ] && continue; [ -e "$d/device" ] || continue
    m=$(cat "$d/address" 2>/dev/null); [ -n "$m" ] || continue
    k=e; { [ -e "$d/wireless" ] || [ -e "$d/phy80211" ]; } && k=w
    # Wi-Fi'nin kalıcı (fabrika) adresi: bağlantı rastgele adres kullanabilir.
    if [ $k = w ] && command -v ethtool >/dev/null 2>&1; then
      p=$(ethtool -P "$n" 2>/dev/null | awk '{print $NF}'); case "$p" in ??:??:??:??:??:??) [ "$p" != 00:00:00:00:00:00 ] && m=$p ;; esac
    fi
    macs="$macs${macs:+,}$n=$m=$k"
  done
  os=$(. /etc/os-release 2>/dev/null; echo "$PRETTY_NAME")
  host=$(hostname 2>/dev/null)
  if command -v curl >/dev/null 2>&1; then
    res=$(curl -fsS -X POST --data-urlencode "hostname=$host" --data-urlencode "os=$os" --data-urlencode "family=linux" \
          --data-urlencode "macs=$macs" "$ANKAMON_URL/done" 2>&1)
  else
    enc() { printf '%s' "$1" | sed 's/%/%25/g; s/ /%20/g; s/&/%26/g; s/+/%2B/g; s/=/%3D/g; s/,/%2C/g'; }
    res=$(wget -qO- --post-data "hostname=$(enc "$host")&os=$(enc "$os")&family=linux&macs=$(enc "$macs")" "$ANKAMON_URL/done" 2>&1)
  fi
  [ -n "$res" ] && ok "$res" || warn "Ankamon'a bildirilemedi; cihazı Ankamon'da Varlıklar ▸ Cihaz ekle ile ekleyebilirsiniz."
  say ""
  say "Bitti. Ankamon bu bilgisayara artık SSH ile erişebilir."
}
main </dev/null
exit $?
