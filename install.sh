#!/usr/bin/env bash
# Tiha-Mon kurulum ve güncelleme betiği.
#
#   İlk kurulum : curl -fsSL https://raw.githubusercontent.com/enseitankado/tiha-mon/main/install.sh | sudo bash
#   Güncelleme  : sudo /opt/tiha-mon/install.sh --update
#                 (ya da: curl -fsSL …/install.sh | sudo bash -s -- --update)
#   MEB ağında curl sertifika hatası verirse ilk komutta curl'e -k ekleyin (betik gerisini kendisi çözer).
#
# Gerekli her şey (Docker, kaynak kod, temel imajlar, kütüphaneler, temalar) kurulumda kendi asıl
# adreslerinden indirilir ve imaj bu makinede derlenir. Kuruluma özel her şey depo DIŞINDADIR:
#   .env   — ayarlar ve parolalar (yoksa .env.example'dan üretilir, parolalar rastgele doldurulur)
#   data/  — veritabanı, Grafana, sertifikalar, yedekler
# --update bunlara dokunmaz: önce veritabanı yedeği alır, yeni kodu çeker, .env'ye yalnız YENİ ayarları
# ekler, yeni imajı eski sistem çalışırken derler, sonra geçer; yeni sürüm sağlıklı açılmazsa önceki
# sürüme kendiliğinden döner.
set -euo pipefail
# Gövde tek bir blokta: bash bloğu ÇALIŞTIRMADAN önce sonuna kadar okur — "curl … | bash" ile çalışırken
# alt süreçlerin stdin'i okuması betiğin kalanını kesemez. Blok dosyanın son satırında kapanır.
{

REPO_URL="${TIHA_MON_REPO:-https://github.com/enseitankado/tiha-mon.git}"
BRANCH="${TIHA_MON_BRANCH:-main}"
INSTALL_DIR="${TIHA_MON_DIR:-/opt/tiha-mon}"
COMPOSE_VERSION="v2.40.3"
PRE_UPDATE_KEEP=3

say()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mUyarı:\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31mHata:\033[0m %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }
as_root() { if [ "$(id -u)" -eq 0 ]; then "$@"; else sudo "$@"; fi; }

usage() {
    sed -n '2,16p' "${BASH_SOURCE[0]:-$0}" 2>/dev/null | sed 's/^# \{0,1\}//'
    exit 0
}

MODE=install
for arg in "$@"; do
    case "$arg" in
        --update|-u) MODE=update ;;
        --help|-h) usage ;;
        *) die "Bilinmeyen seçenek: $arg (kullanım: install.sh [--update])" ;;
    esac
done

# Güncelleme bu dosyanın kendisini de yeniler; bash betiği okurken dosya değişmesin diye güncelleme
# geçici bir kopyadan yürütülür (kurulum dizini ortam değişkeniyle taşınır).
if [ "$MODE" = update ] && [ -z "${TIHA_MON_REEXEC:-}" ] && [ -f "${BASH_SOURCE[0]:-}" ]; then
    self_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    copy=$(mktemp /tmp/tiha-mon-install.XXXXXX)
    cp "${BASH_SOURCE[0]}" "$copy"
    [ -f "$self_dir/docker-compose.yml" ] && export TIHA_MON_DIR="$self_dir"
    TIHA_MON_REEXEC=1 exec bash "$copy" "$@"
fi
[ -z "${TIHA_MON_REEXEC:-}" ] || trap 'rm -f "${BASH_SOURCE[0]}"' EXIT

# ------------------------------------------------------------------ MEB filtresi (HTTPS kesme)
# Okul ağlarındaki MEB filtresi GitHub, Docker Hub vb. HTTPS bağlantılarını kendi kök sertifikasıyla
# yeniden imzalar. Sistem bu köke güvenmiyorsa ne git ne de Docker imaj çekebilir. Bu durum TESPİT
# EDİLİRSE (yalnız o zaman) aşağıdaki MEB kökü sistemin güven deposuna eklenir; filtresiz ağlarda
# hiçbir şey yapılmaz. (Aynı kök depoda docker/rootfs/certs/meb-ca.crt — imaj içindeki kullanım için.)
MEB_CA='-----BEGIN CERTIFICATE-----
MIIDfzCCAmegAwIBAgIQYazX7ESZkLxDARAO7Iyu2jANBgkqhkiG9w0BAQsFADBS
MRIwEAYKCZImiZPyLGQBGRYCdHIxEzARBgoJkiaJk/IsZAEZFgNnb3YxFTATBgoJ
kiaJk/IsZAEZFgVtZWJjYTEQMA4GA1UEAxMHZmF0aWhjYTAeFw0xNjAzMDkxNTM2
MjVaFw0zNjAzMDkxNTQ2MjVaMFIxEjAQBgoJkiaJk/IsZAEZFgJ0cjETMBEGCgmS
JomT8ixkARkWA2dvdjEVMBMGCgmSJomT8ixkARkWBW1lYmNhMRAwDgYDVQQDEwdm
YXRpaGNhMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAwV3KFFTIoP3Q
j99VEocbGVYbRfAZ7i/tVsjeC7cdNc4m5UJginq68Pwu5Mk32G2Dy1zBoOJYyXyo
nf/KWnaMrp7N/5gCBLw7rNoSS8AXhmMQCw7AECDdcJT4jNIB2xuKY6+xq0SeqhB6
ZohFM/NIP9mEk1pa1RcM3BE/X8qLPxgqnJHCqceuqaut/J/dErcNW1WYjG7REf8G
v+h9bs+IDp0QUtXOt1/117c2aaGPUshXS5Vy4y3D61nDLQBF2sW+kjnVT8nheCkQ
4v5x4Aa9tT7IZJnWAaAAdRl61dZ3c2x+Lawd/47Jzwf3xGAowSV70ctteJ3vYp4O
xkMUa7vYFQIDAQABo1EwTzALBgNVHQ8EBAMCAYYwDwYDVR0TAQH/BAUwAwEB/zAd
BgNVHQ4EFgQU/vlLQqALawQN3grbFGcX13fSWkowEAYJKwYBBAGCNxUBBAMCAQAw
DQYJKoZIhvcNAQELBQADggEBAIEjFGJQjxqvATP9Lhq4TkuWcc6Pa0Nnc/fKVgsC
LASiDlF5HogcktDSjapO6w+oT3bHvUnEJVsr2TwW0YrdHbuD/ZEsmZ6dYTTPxZtQ
TFPFroMr8yAOs2F+rUOc2wVCmd7GmSz4TWWCsltl5kNrlHZ9/0aGwV2EXwBfmM9z
b8c4THA24LukeCrEGRPVb2IX4ZmG/a6pF1lBuFo27kh2nz98sB4H5sJG5SozWBF/
sfiOV5hYvXQpheBG8HaiMzhjekKgL0rQLno0fgasjrZX3KMkCcxPPoiitu0AFkEB
jB12iv+M0D3N9kmIxeFN6yH7k9rtHUUuXWTSjSB99Fdv6qA=
-----END CERTIFICATE-----'
MEB_CA_INSTALLED=

ensure_tls() {
    local rc=0 probe=https://github.com tmp
    curl -sS -o /dev/null --max-time 20 "$probe" 2>/dev/null || rc=$?
    [ "$rc" = 60 ] || return 0          # 60: sertifika doğrulanamadı — başka her durumda dokunma
    tmp=$(mktemp)
    printf '%s\n' "$MEB_CA" > "$tmp"
    if ! curl -sS -o /dev/null --max-time 20 --cacert "$tmp" "$probe" 2>/dev/null; then
        rm -f "$tmp"
        warn "HTTPS sertifikası doğrulanamıyor ve MEB kökü de çözmüyor; ağ/saat ayarlarını denetleyin."
        return 0
    fi
    say "MEB filtresi HTTPS'i kesiyor: MEB kök sertifikası sistemin güven deposuna ekleniyor…"
    if [ -d /usr/local/share/ca-certificates ] && have update-ca-certificates; then
        as_root install -m 644 "$tmp" /usr/local/share/ca-certificates/meb-fatihca.crt
        as_root update-ca-certificates >/dev/null
    elif [ -d /etc/pki/ca-trust/source/anchors ] && have update-ca-trust; then
        as_root install -m 644 "$tmp" /etc/pki/ca-trust/source/anchors/meb-fatihca.crt
        as_root update-ca-trust
    else
        rm -f "$tmp"
        die "MEB kök sertifikası bu sistemde güven deposuna eklenemedi; elle ekleyip yeniden deneyin."
    fi
    rm -f "$tmp"
    MEB_CA_INSTALLED=1
}

# ------------------------------------------------------------------ Docker
install_docker() {
    say "Docker kuruluyor…"
    have apt-get || die "Docker kurulu değil ve bu sistemde apt yok. Docker'ı elle kurup betiği yeniden çalıştırın."
    as_root apt-get update -q
    # Önce Docker'ın kendi betiği; dağıtımı tanımazsa (ör. Pardus) dağıtımın paketine düş.
    if ! (curl -fsSL https://get.docker.com | as_root sh); then
        warn "get.docker.com betiği bu dağıtımda çalışmadı; dağıtım paketleri kuruluyor."
        as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io
    fi
    as_root systemctl enable --now docker
}

install_compose() {
    say "Docker Compose eklentisi kuruluyor…"
    if have apt-get && as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y docker-compose-plugin 2>/dev/null; then
        return
    fi
    local arch plugin_dir=/usr/local/lib/docker/cli-plugins
    case "$(uname -m)" in
        x86_64) arch=x86_64 ;;
        aarch64) arch=aarch64 ;;
        *) die "Desteklenmeyen mimari: $(uname -m)" ;;
    esac
    as_root mkdir -p "$plugin_dir"
    as_root curl -fsSL -o "$plugin_dir/docker-compose" \
        "https://github.com/docker/compose/releases/download/$COMPOSE_VERSION/docker-compose-linux-$arch"
    as_root chmod +x "$plugin_dir/docker-compose"
}

have curl || die "curl gerekli."
ensure_tls
have docker || install_docker
# Güven deposu az önce değiştiyse Docker servisi yeni kökü ancak yeniden başlayınca görür.
[ -z "$MEB_CA_INSTALLED" ] || as_root systemctl restart docker 2>/dev/null || true
docker compose version >/dev/null 2>&1 || as_root docker compose version >/dev/null 2>&1 || install_compose

# Docker'a erişimi olmayan kullanıcıda komutları sudo ile çalıştır.
if docker info >/dev/null 2>&1; then DOCKER=(docker); else DOCKER=(as_root docker); fi
"${DOCKER[@]}" info >/dev/null 2>&1 || die "Docker servisine erişilemiyor."
# Sunucu yeniden açıldığında (ör. elektrik kesintisi sonrası) yığın kendiliğinden kalksın.
as_root systemctl enable docker >/dev/null 2>&1 || warn "Docker açılışta başlayacak şekilde ayarlanamadı."

# ------------------------------------------------------------------ mDNS (<ad>.local)
# İstemciler sunucuya çoğunlukla https://<ad>.local ile ulaşır. Avahi varsayılan olarak adı TÜM
# arayüzlerden duyurur: Docker'ın sanal bağlantılarının (veth*, docker0, br-*) LAN'dan ulaşılamayan
# IPv6 adresleri de yayınlanır, tarayıcı IPv6'yı tercih edip o adreste takılıp kalır (sayfa "dönüp
# durur", sunucuya hiç istek gelmez). Ayrıca nginx yalnız IPv4'te dinler. Bu yüzden: ad yalnız
# fiziksel ağ kartlarından (sysfs'te "device" bağı olanlar) ve yalnız IPv4 adresiyle duyurulur.
# Avahi yoksa hiçbir şey yapılmaz; ayar zaten doğruysa dosyaya dokunulmaz.
configure_avahi() {
    local conf=/etc/avahi/avahi-daemon.conf ifaces="" d
    [ -f "$conf" ] || return 0
    for d in /sys/class/net/*; do
        [ -e "$d/device" ] && ifaces="$ifaces${ifaces:+,}${d##*/}"
    done
    [ -n "$ifaces" ] || { warn "Fiziksel ağ kartı bulunamadı; Avahi ayarına dokunulmadı."; return 0; }

    local want="allow-interfaces=$ifaces
use-ipv6=no
publish-aaaa-on-ipv4=no"
    local have_now
    have_now=$(grep -E '^(allow-interfaces|use-ipv6|publish-aaaa-on-ipv4)=' "$conf" | sort)
    [ "$have_now" = "$(printf '%s\n' "$want" | sort)" ] && return 0

    say "Avahi (mDNS): $(hostname).local yalnız fiziksel kartlardan ($ifaces) ve IPv4 ile duyurulacak…"
    as_root cp -n "$conf" "$conf.bak-tihamon"
    local key
    for key in allow-interfaces use-ipv6 publish-aaaa-on-ipv4; do
        local line
        line=$(printf '%s\n' "$want" | grep "^$key=")
        if grep -qE "^#?$key=" "$conf"; then
            as_root sed -i "s|^#\?$key=.*|$line|" "$conf"
        else
            as_root sed -i "/^\[server\]/a $line" "$conf"
        fi
    done
    as_root systemctl restart avahi-daemon 2>/dev/null || warn "avahi-daemon yeniden başlatılamadı."
}
configure_avahi || warn "Avahi ayarlanamadı; istemciler sunucuya IP adresiyle bağlanabilir."

# ------------------------------------------------------------------ Ağlar arası yalıtım
# Sunucu tahta ağına ve idari ağa ayrı kartlarla bağlı olabilir; bu ağlar switch'te yalıtılmıştır ve
# sunucu bu yalıtımı delmemelidir. Docker ip_forward'ı açar; bugün FORWARD zincirinin DROP politikası
# (Docker'ın koyduğu) korur, ama buna güvenilmez: fiziksel kartlar arasında yönlendirme kendi nftables
# tablomuzla açıkça düşürülür (Docker köprüleri — derleme/yardımcı konteynerler — muaf). Tiha-Mon host
# ağında çalıştığı için yönlendirmeye hiç ihtiyaç duymaz. Ayrıca: aynı ağdaki iki kart birbirinin IP'si
# için ARP yanıtı vermesin (ARP flux) ve sunucu ICMP yönlendirme bildirimi (redirect) göndermesin.
# Kaldırmak için: sudo systemctl disable --now tihamon-netguard
configure_netguard() {
    local sysctl_conf=/etc/sysctl.d/90-tihamon-net.conf
    local want_sysctl="# tiha-mon (install.sh): ARP yanıtı yalnız adresin sahibi karttan; ICMP redirect yok.
net.ipv4.conf.all.arp_ignore = 1
net.ipv4.conf.default.arp_ignore = 1
net.ipv4.conf.all.arp_announce = 2
net.ipv4.conf.default.arp_announce = 2
net.ipv4.conf.all.send_redirects = 0
net.ipv4.conf.default.send_redirects = 0"
    if [ "$(cat "$sysctl_conf" 2>/dev/null)" != "$want_sysctl" ]; then
        printf '%s\n' "$want_sysctl" | as_root tee "$sysctl_conf" >/dev/null
        as_root sysctl -q -p "$sysctl_conf" >/dev/null || warn "Ağ sysctl ayarları uygulanamadı."
    fi

    local nft
    nft=$(command -v nft || true)
    if [ -z "$nft" ] && have apt-get; then
        as_root apt-get install -y -q nftables >/dev/null 2>&1 || true
        nft=$(command -v nft || true)
    fi
    [ -n "$nft" ] || { warn "nft bulunamadı; ağlar arası yönlendirme yalnız Docker'ın FORWARD politikasıyla engelli."; return 0; }

    local rules=/etc/tihamon/netguard.nft unit=/etc/systemd/system/tihamon-netguard.service
    local want_rules='# tiha-mon (install.sh): fiziksel ağ kartları arasında IP yönlendirmesi yok (tahta ağı <-> idari ağ).
# Docker köprüleri (docker0, br-*) muaf: derleme ve yardımcı konteynerler dışarı çıkabilsin.
table inet tihamon_guard
delete table inet tihamon_guard
table inet tihamon_guard {
    chain forward {
        type filter hook forward priority filter - 10; policy accept;
        iifname "docker0" accept
        iifname "br-*" accept
        oifname "docker0" accept
        oifname "br-*" accept
        counter drop
    }
}'
    local want_unit="[Unit]
Description=tiha-mon: ağ kartları arası yönlendirme engeli
After=network-pre.target
Wants=network-pre.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=$nft -f $rules
ExecStop=$nft delete table inet tihamon_guard

[Install]
WantedBy=multi-user.target"
    if [ "$(cat "$rules" 2>/dev/null)" != "$want_rules" ] || [ "$(cat "$unit" 2>/dev/null)" != "$want_unit" ]; then
        say "Ağlar arası yalıtım: fiziksel kartlar arasında yönlendirme engelleniyor (tihamon-netguard)…"
        as_root mkdir -p /etc/tihamon
        printf '%s\n' "$want_rules" | as_root tee "$rules" >/dev/null
        printf '%s\n' "$want_unit" | as_root tee "$unit" >/dev/null
        as_root systemctl daemon-reload
    fi
    as_root systemctl enable tihamon-netguard >/dev/null 2>&1 || true
    as_root systemctl restart tihamon-netguard || warn "tihamon-netguard başlatılamadı (bkz. journalctl -u tihamon-netguard)."
}
configure_netguard || warn "Ağlar arası yalıtım ayarlanamadı."

# ------------------------------------------------------------------ Kaynak kod
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || true)"
if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/docker-compose.yml" ]; then
    INSTALL_DIR="$SCRIPT_DIR"     # betik bir kurulum/çalışma dizininden çalıştırıldı
fi

if [ ! -f "$INSTALL_DIR/docker-compose.yml" ]; then
    [ "$MODE" = install ] || die "$INSTALL_DIR altında kurulum yok; önce --update OLMADAN kurun."
    have git || as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y git
    say "Kaynak kod indiriliyor: $REPO_URL → $INSTALL_DIR"
    as_root git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
elif [ "$MODE" = install ]; then
    say "Mevcut kurulum bulundu: $INSTALL_DIR (kod güncellemek için: $INSTALL_DIR/install.sh --update)"
fi
cd "$INSTALL_DIR"
# Dizin başka kullanıcıya aitse (ör. /opt altında) dosya işlemleri root ile yapılır.
if [ -w . ]; then run() { "$@"; }; else run() { as_root "$@"; }; fi
git_() { run git -c safe.directory="$INSTALL_DIR" "$@"; }
# stdin kapalı: "curl … | bash" ile çalışırken docker betiğin kalanını stdin'den yutmasın.
compose() { "${DOCKER[@]}" compose "$@" </dev/null; }
stack_running() { [ -n "$(compose ps -q 2>/dev/null)" ]; }

OLD_REV=
NEW_REV=
if [ "$MODE" = update ]; then
    [ -d .git ] || die "$INSTALL_DIR bir git deposu değil; --update yalnız install.sh ile kurulmuş dizinlerde çalışır."
    # Depodaki dosyalar elle değiştirilmişse ÜZERİNE YAZILMAZ: kullanıcı bilerek karar versin.
    changed=$(git_ status --porcelain --untracked-files=no)
    if [ -n "$changed" ]; then
        printf '%s\n' "$changed" >&2
        die "Yukarıdaki dosyalar bu sunucuda elle değiştirilmiş; güncelleme bunları silerdi. Değişiklikleri geri alın (git -C $INSTALL_DIR checkout -- .) ya da başka yere kaydedip yeniden deneyin."
    fi
    OLD_REV=$(git_ rev-parse HEAD)
    say "Yeni sürüm denetleniyor ($BRANCH)…"
    git_ fetch --depth 1 origin "$BRANCH"
    NEW_REV=$(git_ rev-parse FETCH_HEAD)
    if [ "$OLD_REV" = "$NEW_REV" ]; then
        say "Kod zaten güncel ($(git_ log -1 --format='%h %s' HEAD)); imaj ve servisler denetleniyor."
    fi
fi

# ------------------------------------------------------------------ .env (kuruluma özel ayarlar)
random() { head -c 48 /dev/urandom | od -An -tx1 | tr -d ' \n' | cut -c1-"$1"; }
env_value() { grep "^$1=" .env | head -n 1 | cut -d= -f2-; }

prepare_env() {
    if [ ! -f .env ]; then
        say ".env oluşturuluyor (varsayılan ayarlar + rastgele parolalar)…"
        run cp .env.example .env
        run chmod 600 .env
    else
        # Yeni sürümde eklenen ayarlar varsayılan değerleriyle sona eklenir; mevcut değerlere dokunulmaz.
        local key line added=""
        while IFS= read -r line; do
            key=${line%%=*}
            grep -q "^$key=" .env || { printf '%s\n' "$line" | run tee -a .env >/dev/null; added="$added $key"; }
        done < <(grep -E '^[A-Z0-9_]+=' .env.example)
        [ -z "$added" ] || say ".env'ye yeni ayarlar eklendi:$added"
    fi
    NEW_ADMIN_PASSWORD=
    local k value
    for k in POSTGRES_PASSWORD PG_GRAFANA_PASSWORD PG_READONLY_PASSWORD GRAFANA_ADMIN_PASSWORD ETAPADMIN_PASSWORD; do
        if grep -q "^$k=\$" .env; then
            if [ "$k" = ETAPADMIN_PASSWORD ]; then value=$(random 12); NEW_ADMIN_PASSWORD=$value; else value=$(random 36); fi
            run sed -i "s|^$k=\$|$k=$value|" .env
        fi
    done
    if grep -q '^BOARD_SSH_PASSWORD=$' .env; then
        warn "Tahta erişim parolası (.env → BOARD_SSH_PASSWORD) boş. Kurulumdan sonra arayüzde Ayarlar'dan girebilirsiniz."
    fi
}

# ------------------------------------------------------------------ Güncelleme öncesi yedek
# Çalışan sistemden veritabanı yedeği (kullanıcılar, tahtalar, ayarlar, Grafana; log/sensör ham verisi
# hariç — o veri data/ altında yerinde kalır, ayrıca günlük tam yedek alınır). Yedek alınamazsa
# güncelleme yapılmaz. Son PRE_UPDATE_KEEP adet saklanır.
pre_update_backup() {
    stack_running || { warn "Sistem çalışmıyor; güncelleme öncesi yedek atlandı (veriler data/ altında yerinde)."; return 0; }
    local ts dir=/data/backups
    ts=$(date +%Y%m%d-%H%M%S)
    say "Güncelleme öncesi yedek alınıyor: data/backups/pre-update-$ts-*.dump"
    compose exec -T tiha-mon sh -c "
        set -e
        export PGHOST=127.0.0.1 PGUSER=tihamon PGPASSWORD=\"\$POSTGRES_PASSWORD\"
        mkdir -p $dir
        pg_dump -Fc -Z 6 -d tihamon --exclude-table-data='_timescaledb_internal.*' -f $dir/pre-update-$ts-tihamon.dump.tmp
        pg_dump -Fc -Z 6 -d grafana -f $dir/pre-update-$ts-grafana.dump.tmp
        for f in $dir/pre-update-$ts-*.dump.tmp; do chmod 600 \"\$f\"; mv \"\$f\" \"\${f%.tmp}\"; done
        ls -1t $dir/pre-update-*-tihamon.dump | tail -n +$((PRE_UPDATE_KEEP + 1)) | while read -r f; do
            rm -f \"\$f\" \"\${f%-tihamon.dump}-grafana.dump\"
        done
    " || die "Güncelleme öncesi yedek alınamadı; güncelleme yapılmadı (sistem olduğu gibi çalışıyor)."
}

# ------------------------------------------------------------------ Port denetimi (yalnız ilk başlatma)
check_ports() {
    HTTP_PORT=$(env_value HTTP_PORT); HTTP_PORT=${HTTP_PORT:-80}
    SYSLOG_PORT=$(env_value SYSLOG_PORT); SYSLOG_PORT=${SYSLOG_PORT:-514}
    HTTPS_PORT=$(env_value HTTPS_PORT); HTTPS_PORT=${HTTPS_PORT:-443}
    CAST_RTSP_PORT=$(env_value CAST_RTSP_PORT); CAST_RTSP_PORT=${CAST_RTSP_PORT:-8554}
    stack_running && return 0
    local port
    port_busy() { have ss && ss -Htln "sport = :$1" 2>/dev/null | grep -q .; }
    for port in "$HTTP_PORT" "$SYSLOG_PORT" "$CAST_RTSP_PORT" $([ "$HTTPS_PORT" = 0 ] || echo "$HTTPS_PORT"); do
        if port_busy "$port"; then
            die "$port numaralı port başka bir servis tarafından kullanılıyor. O servisi durdurun ya da $INSTALL_DIR/.env içinde portu değiştirip betiği yeniden çalıştırın."
        fi
    done
}

wait_healthy() {
    local _
    for _ in $(seq 1 80); do
        curl -fsS -o /dev/null "http://127.0.0.1:$HTTP_PORT/api/health" 2>/dev/null && return 0
        sleep 3
    done
    return 1
}

# ------------------------------------------------------------------ Akış
if [ "$MODE" = update ]; then
    pre_update_backup
    if [ "$OLD_REV" != "$NEW_REV" ]; then
        say "Kod güncelleniyor: $(git_ log -1 --format='%h' "$OLD_REV") → $(git_ log -1 --format='%h %s' "$NEW_REV")"
        # .env ve data/ depo dışındadır (.gitignore) — reset onlara dokunmaz.
        git_ reset -q --hard "$NEW_REV"
    fi
fi
prepare_env
check_ports

# Yeni imaj, ESKİ sistem çalışırken derlenir: derleme başarısız olursa çalışan sisteme hiç dokunulmaz.
say "İmaj derleniyor (bağımlılıklar asıl kaynaklarından indirilir; ilk kurulum birkaç dakika sürer)…"
if ! compose build --pull; then
    if [ "$MODE" = update ] && [ "$OLD_REV" != "$NEW_REV" ]; then
        git_ reset -q --hard "$OLD_REV"
        die "Yeni sürüm derlenemedi; kod önceki sürüme ($(git_ log -1 --format='%h' HEAD)) döndürüldü, çalışan sistem etkilenmedi."
    fi
    die "İmaj derlenemedi (yukarıdaki çıktıya bakın)."
fi
say "Servisler başlatılıyor…"
compose up -d --remove-orphans

say "Servislerin hazır olması bekleniyor…"
if ! wait_healthy; then
    if [ "$MODE" = update ] && [ "$OLD_REV" != "$NEW_REV" ]; then
        warn "Yeni sürüm sağlıklı açılmadı; önceki sürüme dönülüyor…"
        git_ reset -q --hard "$OLD_REV"
        compose build && compose up -d --remove-orphans && wait_healthy \
            && die "Önceki sürüme ($(git_ log -1 --format='%h' HEAD)) dönüldü, sistem çalışıyor. Yeni sürümün günlükleri için: cd $INSTALL_DIR && docker compose logs --tail=100"
        die "Önceki sürüme dönüldü ama sistem yine açılmadı. Günlükler: cd $INSTALL_DIR && docker compose logs --tail=100 — güncelleme öncesi yedek: data/backups/pre-update-*"
    fi
    die "Arayüz yanıt vermiyor. Günlükler: cd $INSTALL_DIR && docker compose logs --tail=50"
fi
# Yeniden derlemelerden kalan adsız (dangling) imaj katmanları disk doldurmasın.
"${DOCKER[@]}" image prune -f >/dev/null 2>&1 || true

ADDRESS=$( (hostname -I 2>/dev/null || ip -4 -o route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p') | awk '{print $1}' || true)
URL="http://${ADDRESS:-localhost}$([ "$HTTP_PORT" = 80 ] || echo ":$HTTP_PORT")"
CA_URL="$URL/tihamon-ca.crt"
[ "$HTTPS_PORT" = 0 ] || URL="https://${ADDRESS:-localhost}$([ "$HTTPS_PORT" = 443 ] || echo ":$HTTPS_PORT")"
echo
if [ "$MODE" = update ]; then
    say "Güncelleme tamam: $(git_ log -1 --format='%h %s (%cd)' --date=short HEAD)"
    echo "    Arayüz        : $URL"
    echo "    Önceki yedek  : $INSTALL_DIR/data/backups/pre-update-*"
    exit 0
fi
say "Tiha-Mon hazır."
echo "    Arayüz        : $URL"
if [ -f /etc/avahi/avahi-daemon.conf ] && [ "$HTTPS_PORT" != 0 ]; then
    echo "                    https://$(hostname).local$([ "$HTTPS_PORT" = 443 ] || echo ":$HTTPS_PORT")  (ağdaki bilgisayarlardan adla)"
fi
[ "$HTTPS_PORT" = 0 ] || echo "    Sertifika     : $CA_URL — yönetici bilgisayarına \"güvenilen kök\" olarak kurun (tarayıcı uyarısı kalkar)"
echo "    Kullanıcı     : etapadmin"
if [ -n "$NEW_ADMIN_PASSWORD" ]; then
    echo "    Parola        : $NEW_ADMIN_PASSWORD   (ilk girişten sonra değiştirin)"
else
    echo "    Parola        : ilk kurulumda belirlenen (ilk değer: $INSTALL_DIR/.env → ETAPADMIN_PASSWORD)"
fi
# Sunucu birden çok ağa bağlıysa (tahta + idari) her kartın adresi; tahtalar kendi ağındakini kullanır.
ADDRESSES=$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9]+(\.[0-9]+){3}$' | grep -v -E '^172\.(1[6-9]|2[0-9]|3[01])\.' | paste -sd ' ' - || true)
echo "    Log sunucusu  : ${ADDRESSES:-${ADDRESS:-bu sunucu}} — port $SYSLOG_PORT (TCP/UDP); TiHA'nın \"Merkezi log sunucusu\" adımına tahtaların ağındaki adresi yazın"
echo "    Ağ arabirimleri: birden çok ağa bağlıysa Ayarlar ▸ Ağ arabirimleri'nden tahta ağını seçin"
echo "    Veri ve yedek : $INSTALL_DIR/data"
echo "    Güncelleme    : sudo $INSTALL_DIR/install.sh --update"
exit 0
}
