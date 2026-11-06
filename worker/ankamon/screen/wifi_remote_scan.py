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

"""Wi-Fi Monitör'ün tahtada çalışan kabuk programı (bkz. wifi.py).

Program /run/ankamon-wifimon/prog.sh olarak yazılıp sh (dash) ile çalışır. Kart kapalıysa geçici açar, tarar, eski durumuna döndürür:
- Radyo kapalıysa önce `nmcli device set <kart> autoconnect no`, sonra radyo açılır; kart kayıtlı ağa bağlanmaz (bu sunucu ağları
  arası geçiş yasak). Yine de bağlanmaya kalkarsa `device disconnect`. Autoconnect kapatılamazsa radyo hiç açılmaz.
- Başlangıç durumu değişiklikten ÖNCE `orig` dosyasına yazılır. Geri yükleme önce radyoyu kapatır, sonra autoconnect'i döndürür.
- Aynı tahtada eşzamanlı oturumlar: `flock` altında oturum sayımı; durumu ilk oturum kaydeder, son çıkan geri yükler.
- Geri yüklemeyi hem ana sürecin trap'i hem `setsid` ile ayrılmış bekçi yapar (ikisi de güvenli, iş bir kez yapılır). Bekçi sunucudan
  gelen stdin kalp atışını okur: EOF (SSH koptu, durdurma istendi), LEASE saniye sessizlik (ağ koptu) ya da ana sürecin ölmesi
  (kill -9) durumunda devreye girer. stdout'u /dev/null'dur; SSH oturumunu açık tutmaz.
- Bluetooth kullanılmaz (kullanıcı kararı 2026-11-06: Wi-Fi Monitör yalnız Wi-Fi). Eski sürümün kalıcı başlangıç dosyasında
  ($P/orig) BT_TEMP=1 kaldıysa geri yükleme Bluetooth'u yine eski durumuna döndürür.
- Wi-Fi trafiği dinleme (PROBE=1, bkz. wifimon_probe_sniffer.py — yoklamalar ve bağlı cihazlar; dinleyiciye son taramanın
  listesi $TMP verilir, AP'lerin kanalları da dinlenir): Wi-Fi kartı BAĞLI DEĞİLSE (durum 20/30) kart NetworkManager'dan geçici
  bırakılır (`managed no`, çalışma zamanı ayarı; açılışta kendiliğinden döner), arabirim indirilir, monitör kipinde ankamon-mon0
  eklenir ve dinlenir; sonra arabirim silinir, kart yeniden `managed yes` olur (autoconnect "no" korunur, Arge 2'de denendi).
  Kart bağlıysa ya da bağlanıyorsa dinlenmez (bağlantı kesilirdi) — FORCE=1 değilse. Aynı tahtada tek oturum dinler (flock -n).
  Geri alma işaretli ($D/unmanaged): finish, bekçi ve restore_orig sahibi ölmüş/biten işareti temizler.
- FORCE=1 (kullanıcı onayı: tahta kabloyla da bağlı, Wi-Fi bağlantısı dinleme süresince kopacak): kart bağlıysa bağlantı adı ve
  autoconnect değeri kalıcı diske ($P/forced) yazılır, autoconnect kapatılır, bağlantı kesilir; oturum boyunca kopuk tutulur
  (block_connect). Son oturum çıkınca (restore_orig) autoconnect döner ve bağlantı yeniden kurulur. Güç kesilirse açılışta
  NetworkManager zaten kendisi bağlanır; dosya bir sonraki oturumda temizlenir.
- SSH koruması: SSH istemcisine giden yol ($SSH_CLIENT, `ip route get`) Wi-Fi kartından geçiyorsa kart HİÇBİR koşulda monitör
  kipine alınmaz (PROBE_NOTE=sshwifi) — yoksa tahtaya erişim kaybolurdu.

- Tahtanın Ankamon Wi-Fi ayarı: "Wi-Fi'yi kapat" işleminin polkit kuralı ($RULE) varsa geri yüklemenin sonunda kart, açılıştaki
  durumu ne olursa olsun kapatılır (Tahtalar grid'inin Wi-Fi sütunu ve wifi-on/wifi-off işlemleriyle tutarlı).

Bilinen sınır: geçici açıkken tahtanın gücü kesilirse trap da bekçi de çalışamaz; NetworkManager radyoyu açık hatırlar. Başlangıç
durumu kalıcı diskte ($P/orig) olduğundan bir sonraki Wi-Fi Monitör oturumu önce onu geri yükler.

Çıktı: önce @@INFO + @@START; her tarama @@RADIO/@@DEV/@@LIST/@@INFO bölümleri + @@END; yoklama dinlendiyse ardından
@@PROBE (JSON satırları) + @@PROBEINFO + @@PEND; sonda @@RESTORED + @@DONE.
"""

from __future__ import annotations

from .wifimon_probe_sniffer import WIFIMON_PROBE_SNIFFER_SOURCE

_WIFIMON_PROGRAM = r"""
export LC_ALL=C.UTF-8 PATH=/usr/sbin:/usr/bin:/sbin:/bin
D=/run/ankamon-wifimon
# Başlangıç durumu kalıcı diskte: pencere açıkken tahtanın gücü kesilirse /run silinir ama bu dosya kalır; sonraki
# Wi-Fi Monitör oturumu (canlı oturum yokken) önce bu durumu geri yükler.
P=/var/lib/ankamon-wifimon
O=$P/orig
L=$D/lock
# Tahtanın Ankamon Wi-Fi ayarı: "Wi-Fi'yi kapat" (actions/wifi-off) bu kuralı kurar, "Wi-Fi'yi aç" siler. Kural varsa
# pencere kapanınca kart her durumda kapalı bırakılır.
RULE=/etc/polkit-1/rules.d/49-ankamon-wifi-off.rules
LEASE=25
SELF=$0
MON=ankamon-mon0

n() { timeout 15 nmcli "$@" 2>/dev/null; }
b() { timeout 5 bluetoothctl "$@" </dev/null 2>/dev/null; }
wifi_radio() { n -t -f WIFI general; }
wifi_state() { [ -n "$1" ] && n -g GENERAL.STATE device show "$1" | cut -d' ' -f1; }

live_sessions() {
  c=0
  for f in "$D"/s.*; do
    [ -e "$f" ] || continue
    if kill -0 "${f##*.}" 2>/dev/null; then c=$((c+1)); else rm -f "$f"; fi
  done
  echo "$c"
}

capture() {
  W_DEV=$(n -t -f DEVICE,TYPE device | sed -n 's/^\(.*\):wifi$/\1/p' | head -n1)
  W_TEMP=0; W_AC=
  if [ -n "$W_DEV" ] && [ "$(wifi_radio)" = disabled ]; then
    W_TEMP=1
    W_AC=$(n -g GENERAL.AUTOCONNECT device show "$W_DEV")
    [ -n "$W_AC" ] || W_AC=yes
  fi
  # Bluetooth'a dokunulmaz; alanlar eski sürümün orig dosyasıyla aynı biçim için yazılır (BT_TEMP=0).
  BT_PRESENT=0; BT_TEMP=0; BT_SVC=; BT_POW=; BT_RFK=
  cat > "$O.new" <<EOF
W_DEV='$W_DEV'
W_TEMP=$W_TEMP
W_AC='$W_AC'
W_FAIL=
BT_PRESENT=$BT_PRESENT
BT_TEMP=$BT_TEMP
BT_SVC='$BT_SVC'
BT_POW='$BT_POW'
BT_RFK='$BT_RFK'
BT_FAIL=
EOF
  sync "$O.new" 2>/dev/null
  mv -f "$O.new" "$O"
}

open_radios() {
  if [ "$W_TEMP" = 1 ]; then
    if n device set "$W_DEV" autoconnect no >/dev/null; then
      n radio wifi on >/dev/null || echo "W_FAIL=radio" >> "$O"
    else
      echo "W_FAIL=autoconnect" >> "$O"
    fi
  fi
}

# Yoklama dinlemesinin geri alınması: $1 boşsa sahibi ne olursa olsun, değilse yalnız o sürecin ya da ölmüş sürecin işareti.
# SSH istemcisine giden yolun arabirimi (Wi-Fi kartıysa monitör kipine alınmaz).
ssh_dev() {
  c=${SSH_CLIENT%% *}
  [ -n "$c" ] && ip route get "$c" 2>/dev/null | sed -n 's/.* dev \([^ ]*\).*/\1/p' | head -n1
}

# FORCE=1: bağlı kartın bağlantısını keser; adı ve autoconnect kalıcı diske (son oturum çıkınca force_restore geri kurar).
force_disconnect() {
  if [ ! -f "$P/forced" ]; then
    f_conn=$(n -g GENERAL.CONNECTION device show "$W_DEV")
    f_ac=$(n -g GENERAL.AUTOCONNECT device show "$W_DEV")
    printf '%s\n%s\n%s\n' "$W_DEV" "${f_ac:-yes}" "$f_conn" > "$P/forced.new" || return 1
    sync "$P/forced.new" 2>/dev/null
    mv -f "$P/forced.new" "$P/forced"
  fi
  n device set "$W_DEV" autoconnect no >/dev/null
  n device disconnect "$W_DEV" >/dev/null
  i=0
  while [ $i -lt 10 ]; do
    case "$(wifi_state "$W_DEV")" in 20|30) DISCONNECTED=1; return 0 ;; esac
    sleep 1 & CUR=$!; wait $CUR; CUR=; i=$((i+1))
  done
  return 1
}

force_restore() {
  [ -f "$P/forced" ] || return 0
  { read -r f_dev; read -r f_ac; read -r f_conn; } < "$P/forced"
  n device set "$f_dev" autoconnect "${f_ac:-yes}" >/dev/null
  if [ -n "$f_conn" ] && [ "$f_conn" != "--" ] && [ "$(wifi_radio)" = enabled ]; then
    timeout 40 nmcli connection up id "$f_conn" ifname "$f_dev" >/dev/null 2>&1 || n device connect "$f_dev" >/dev/null
  fi
  rm -f "$P/forced"
}

probe_undo() {
  [ -f "$D/unmanaged" ] || { iw dev "$MON" del >/dev/null 2>&1; return 0; }
  read -r u_dev u_pid < "$D/unmanaged"
  if [ -n "$1" ] && [ "$u_pid" != "$1" ] && kill -0 "$u_pid" 2>/dev/null; then return 0; fi
  iw dev "$MON" del >/dev/null 2>&1
  n device set "$u_dev" managed yes >/dev/null && rm -f "$D/unmanaged"
}

# $1 saniye dinler, sonuç $PTMP'de; PROBE_NOTE: neden dinlenmediği (boşsa dinlendi).
probe_sniff() {
  : > "$PTMP"; PROBE_NOTE=
  [ -n "$W_DEV" ] || { PROBE_NOTE=nodev; return 0; }
  { command -v iw && command -v python3; } >/dev/null 2>&1 || { PROBE_NOTE=tools; return 0; }
  [ "$(wifi_radio)" = enabled ] || { PROBE_NOTE=radio; return 0; }
  # SSH bu karttan geliyorsa monitör kipi tahtaya erişimi keserdi: hiçbir koşulda (FORCE olsa da) dinlenmez.
  [ -n "$SSH_DEV" ] && [ "$SSH_DEV" = "$W_DEV" ] && { PROBE_NOTE=sshwifi; return 0; }
  case "$(wifi_state "$W_DEV")" in
    20|30) ;;
    *) if [ "$FORCE" = 1 ]; then force_disconnect || { PROBE_NOTE=busy; return 0; }; else PROBE_NOTE=busy; return 0; fi ;;
  esac
  phy=$(iw dev "$W_DEV" info 2>/dev/null | sed -n 's/.*wiphy \([0-9]*\).*/phy\1/p')
  iw phy "$phy" info 2>/dev/null | grep -q '^[[:space:]]*\* monitor$' || { PROBE_NOTE=nomon; return 0; }
  exec 8>"$D/probe.lock"
  flock -n 8 || { exec 8>&-; PROBE_NOTE=shared; return 0; }
  probe_undo
  echo "$W_DEV $ME" > "$D/unmanaged"
  if n device set "$W_DEV" managed no >/dev/null && ip link set "$W_DEV" down 2>/dev/null &&
     iw phy "$phy" interface add "$MON" type monitor >/dev/null 2>&1 && ip link set "$MON" up 2>/dev/null; then
    timeout $(($1+5)) python3 "$D/probe.py" "$MON" "$1" "$TMP" > "$PTMP" & CUR=$!; wait $CUR; CUR=
  else
    PROBE_NOTE=monfail
  fi
  probe_undo "$ME"
  exec 8>&-
  i=0
  while [ $i -lt 10 ]; do
    s=$(wifi_state "$W_DEV"); [ -n "$s" ] && [ "$s" -ge 30 ] 2>/dev/null && break
    sleep 1 & CUR=$!; wait $CUR; CUR=; i=$((i+1))
  done
  block_connect
}

restore_orig() {
  probe_undo
  force_restore
  [ -f "$O" ] || { echo none; return 0; }
  . "$O"
  ok=1
  if [ "$W_TEMP" = 1 ]; then
    i=0
    while :; do
      n radio wifi off >/dev/null
      [ "$(wifi_radio)" = disabled ] && break
      i=$((i+1))
      [ $i -ge 3 ] && { ok=0; break; }
      sleep 1
    done
    n device set "$W_DEV" autoconnect "$W_AC" >/dev/null || ok=0
  fi
  if [ "$BT_TEMP" = 1 ]; then
    { [ "$BT_SVC" = active ] && [ "$BT_POW" = yes ]; } || b power off >/dev/null
    [ "$BT_SVC" = active ] || timeout 15 systemctl stop bluetooth >/dev/null 2>&1
    for r in $BT_RFK; do echo 1 > "$r/soft" 2>/dev/null; done
  fi
  if [ -e "$RULE" ] && [ -n "$W_DEV" ] && [ "$(wifi_radio)" = enabled ]; then
    n radio wifi off >/dev/null
    sleep 1
    [ "$(wifi_radio)" = disabled ] || { n radio wifi off >/dev/null; [ "$(wifi_radio)" = disabled ] || ok=0; }
  fi
  if [ $ok = 1 ]; then rm -f "$O"; echo restored; else echo fail; fi
}

acquire() {
  (
    flock -w 40 9 || exit 1
    if [ "$(live_sessions)" = 0 ] && { [ -f "$O" ] || [ -f "$P/forced" ]; }; then restore_orig >/dev/null; fi
    if [ ! -f "$O" ]; then capture; . "$O"; open_radios; fi
    : > "$D/s.$1"
  ) 9>"$L"
}

release() {
  (
    flock -w 40 9 || { echo fail; exit 1; }
    rm -f "$D/s.$1"
    if [ "$(live_sessions)" = 0 ]; then restore_orig; else echo shared; fi
  ) 9>"$L"
}

guard() {
  M=$1
  last=$(date +%s)
  while kill -0 "$M" 2>/dev/null; do
    line=$(timeout 3 head -n1); rc=$?
    now=$(date +%s)
    if [ $rc = 0 ]; then
      [ -n "$line" ] || break
      last=$now
    elif [ $((now-last)) -ge $LEASE ]; then
      break
    fi
  done
  kill -TERM "$M" 2>/dev/null
  i=0
  while kill -0 "$M" 2>/dev/null && [ $i -lt 6 ]; do sleep 1; i=$((i+1)); done
  probe_undo "$M"
  release "$M" >/dev/null
  kill -KILL "$M" 2>/dev/null
  rm -f "$D/list.$M" "$D/probe.$M"
}

finish() {
  trap '' TERM HUP INT PIPE
  [ -n "$CUR" ] && kill "$CUR" 2>/dev/null
  probe_undo "$ME"
  res=$(release "$ME")
  rm -f "$TMP" "$PTMP"
  echo '@@RESTORED'
  echo "result=$res"
  echo "wifi_temp=$W_TEMP"
  echo "wifi_fail=$W_FAIL"
  echo "radio=$(wifi_radio)"
  echo "policy=$([ -e "$RULE" ] && echo off)"
  echo '@@DONE'
  exit 0
}

info() {
  echo '@@INFO'
  echo "wifi_temp=$W_TEMP"
  echo "wifi_fail=$W_FAIL"
  echo "disconnected=$DISCONNECTED"
  echo "forced=$([ -f "$P/forced" ] && echo 1)"
}

# Geçici açık kart kendiliğinden bağlanmaya kalkarsa bağlantıyı keser. Autoconnect her seferinde yeniden kapatılır:
# NetworkManager yeniden başlarsa bu çalışma zamanı ayarı "yes"e döner (Arge 1'de görüldü).
block_connect() {
  if [ -f "$P/forced" ] && [ -n "$W_DEV" ]; then
    n device set "$W_DEV" autoconnect no >/dev/null
    case "$(wifi_state "$W_DEV")" in
      40|50|60|70|80|90|100) n device disconnect "$W_DEV" >/dev/null ;;
    esac
    return 0
  fi
  { [ "$W_TEMP" = 1 ] && [ -z "$W_FAIL" ]; } || return 0
  n device set "$W_DEV" autoconnect no >/dev/null
  case "$(wifi_state "$W_DEV")" in
    40|50|60|70|80|90|100) n device disconnect "$W_DEV" >/dev/null; DISCONNECTED=1 ;;
  esac
}

wifi_wait_ready() {
  { [ "$W_TEMP" = 1 ] && [ -z "$W_FAIL" ]; } || return 0
  i=0
  while [ $i -lt 15 ]; do
    s=$(wifi_state "$W_DEV")
    [ -n "$s" ] && [ "$s" -ge 30 ] 2>/dev/null && return 0
    sleep 1 & CUR=$!; wait $CUR; CUR=
    i=$((i+1))
  done
  W_FAIL=timeout
}

# Sonuç $TMP dosyasında (trap'in çıktısı yönlendirmeye karışmasın diye işlevin stdout'u yönlendirilmez).
wifi_list() {
  : > "$TMP"
  [ -n "$W_DEV" ] || return 0
  [ "$(wifi_radio)" = enabled ] || return 0
  for mode in "$1" no; do
    timeout 25 nmcli -t -f IN-USE,BSSID,SSID,CHAN,FREQ,RATE,SIGNAL,SECURITY device wifi list ifname "$W_DEV" --rescan "$mode" >"$TMP" 2>/dev/null &
    CUR=$!; wait $CUR; rc=$?; CUR=
    [ $rc = 0 ] && break
  done
}

scan_once() {
  wifi_wait_ready
  block_connect
  mode=yes
  [ "$(wifi_state "$W_DEV")" = 100 ] && mode=auto
  wifi_list "$mode"
  block_connect
  echo '@@RADIO'; wifi_radio
  echo '@@DEV'; n -t -f DEVICE,TYPE,STATE,CONNECTION device
  echo '@@LIST'; cat "$TMP"
  info
  echo '@@END'
  [ "$PROBE" = 1 ] || return 0
  probe_sniff "$PROBE_SECS"
  echo '@@PROBE'; cat "$PTMP"
  echo '@@PROBEINFO'
  echo "note=$PROBE_NOTE"
  echo "secs=$PROBE_SECS"
  echo '@@PEND'
}

main() {
  WATCH=$1
  PROBE=$2
  FORCE=$3
  SSH_DEV=$(ssh_dev)
  PROBE_SECS=15
  [ "$WATCH" = 1 ] && PROBE_SECS=20
  ME=$$
  TMP=$D/list.$ME
  PTMP=$D/probe.$ME
  CUR=; PROBE_NOTE=; W_DEV=; W_TEMP=0; W_FAIL=; BT_PRESENT=0; BT_TEMP=0; BT_FAIL=; DISCONNECTED=0
  exec 2>/dev/null 3<&0 </dev/null
  mkdir -p "$P" || { echo '@@RESTORED'; echo 'result=lock'; echo '@@DONE'; exit 1; }
  [ -f "$D/orig" ] && [ ! -f "$O" ] && mv -f "$D/orig" "$O"
  trap finish TERM HUP INT PIPE
  setsid sh "$SELF" guard "$ME" <&3 3<&- >/dev/null 2>&1 &
  exec 3<&-
  acquire "$ME" || { echo '@@RESTORED'; echo 'result=lock'; echo '@@DONE'; exit 1; }
  . "$O"
  info
  echo '@@START'
  while :; do
    scan_once
    [ "$WATCH" = 1 ] || break
    # Yoklama dinlendiyse tarama arası beklemesi o süre içinde geçti.
    { [ "$PROBE" = 1 ] && [ -z "$PROBE_NOTE" ]; } && continue
    sleep 6 & CUR=$!; wait $CUR; CUR=
  done
  finish
}

case "$1" in
  main) main "$2" "$3" "$4" ;;
  guard) guard "$2" ;;
esac
"""


def wifimon_remote_command(watch: bool, probe: bool = False, force: bool = False) -> str:
    """SSH ile tahtaya verilecek komut: programı (ve yoklama dinleyicisini) /run altına yazar, çalıştırır.
    Çıkış: 49 nmcli yok, 48 /run yazılamıyor."""
    return (
        "command -v nmcli >/dev/null 2>&1 || { echo NO_NMCLI >&2; exit 49; }\n"
        "umask 077; mkdir -p /run/ankamon-wifimon 2>/dev/null || exit 48\n"
        "cat > /run/ankamon-wifimon/prog.$$ <<'ANKAMON_WIFIMON_EOF' || exit 48"
        + _WIFIMON_PROGRAM
        + "ANKAMON_WIFIMON_EOF\n"
        "mv -f /run/ankamon-wifimon/prog.$$ /run/ankamon-wifimon/prog.sh || exit 48\n"
        + ("cat > /run/ankamon-wifimon/probe.py <<'ANKAMON_WIFIMON_PROBE_EOF' || exit 48"
           + WIFIMON_PROBE_SNIFFER_SOURCE + "ANKAMON_WIFIMON_PROBE_EOF\n" if probe else "")
        + f"exec sh /run/ankamon-wifimon/prog.sh main {1 if watch else 0} {1 if probe else 0} {1 if force and probe else 0}\n"
    )
