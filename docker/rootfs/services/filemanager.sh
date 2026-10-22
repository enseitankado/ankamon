#!/bin/sh
# Dosya yöneticisi (FileBrowser Quantum): tahtaların (sshfs ile bağlanan, bkz. filemanager-bridge.sh)
# kök dizin ağacını sunar. Yalnız 127.0.0.1:8893 dinler; nginx /filemanager/ ile oturum + "filemanager"
# yetkisiyle vekiller ve sabit bir X-Auth-User başlığı geçirir — kimlik/yetki zaten nginx'te denetlendi,
# bu uygulamanın kendi oturum açma ekranına hiç gerek yok (proxy kimlik doğrulaması, ilk istekte
# kullanıcıyı kendiliğinden oluşturur). Veritabanı (tek paylaşılan "tihamon" hesabının tema/dil gibi
# tercihlerini tutar — kullanıcı isteği: bunlar container yeniden oluşturulsa da HATIRLANMALI) /data
# altında kalıcıdır (bkz. /data/postgres, /data/grafana ile aynı yerleşim); önbellek (cacheDir) ise
# sadece performans için, kaybı önemsiz olduğundan /run altında (ephemeral, disk tasarrufu) kalır.
set -eu

APP=/run/tiha-mon/filemanager-app
DATA=/data/filemanager
THEMES=/opt/tiha-mon/filemanager/themes
mkdir -p "$APP" "$APP/cache" "$DATA" /run/tiha-mon/filemanager
# İkili, göreli yoldan (ör. "tmp/") yazdığı şeyleri çalışma dizinine göre konumlandırıyor; konteyner
# imajının kendi dizinini (/opt) kirletmesin diye çalışma dizini de /run altında olsun. Arayüzü de
# çalışma dizinindeki internal/web/dist'ten sunar (2.x imajında ikiliye gömülü değil).
mkdir -p "$APP/internal/web"
ln -sfn /opt/tiha-mon/filemanager/dist "$APP/internal/web/dist"
ln -sf /opt/tiha-mon/filemanager/filebrowser "$APP/filebrowser"
rm -f "$APP/http"
# 1.5.x'in BoltDB'si (database.db) 2.x'te SQLite'a bir kez aktarılır: kullanıcılar, tema/koyu kip
# tercihleri. migrateFrom yalnız SQLite henüz yokken verilir (yoksa dosya yokken açılış hata verir);
# eski dosya olduğu gibi kalır.
MIGRATE=
if [ ! -s "$DATA/filebrowser.sqlite" ] && [ -s "$DATA/database.db" ]; then
    MIGRATE="    migrateFrom: \"$DATA/database.db\""
fi
cat > "$APP/config.yaml" <<YAML
http:
  port: 8893
  listen: "127.0.0.1"
  baseURL: "/filemanager"
  # Yalnız nginx'ten gelir (127.0.0.1); istemci adresi nginx'in X-Real-IP/X-Forwarded-For'undan alınır.
  trustProxyHeaders: true
  # Kullanılmıyor; açık kalsa /filemanager/dav/ nginx üzerinden erişilebilir olurdu.
  disableWebDAV: true
server:
  # Açılışta/periyodik GitHub sorgusu (okul ağındaki filtre HTTPS'i keser); sürümü imaj belirler.
  disableUpdateCheck: true
  numImageProcessors: 1
  sources:
    - path: "/run/tiha-mon/filemanager"
      name: "tahtalar"
      config:
        private: true
        defaultPermissions:
          view: true
          download: true
          modify: true
          create: true
          delete: true
  cacheDir: "$APP/cache"
  cacheDirCleanup: true
  database:
    path: "$DATA/filebrowser.sqlite"
$MIGRATE
frontend:
  disableDefaultLinks: true
  disablePWAInstall: true
  styling:
    customCSS: "/opt/tiha-mon/filemanager/tihamon.css"
    # tiha-mon Ayarlar'daki temaların karşılıkları (bkz. docker/rootfs/filemanager/themes/*.css —
    # renkler o temaların qooxdoo paletinden). Seçim: dosya yöneticisi → Ayarlar → Profil → Tema;
    # tercih /data/filemanager veritabanında kalıcı. "default" anahtarı, hiç seçim yapılmamışken
    # kullanılan temadır (tiha-mon'un varsayılanı "Açık (Mavi)"). Koyu temalar FileBrowser'ın kendi koyu
    # kipiyle (kenar çubuğundaki ay simgesi) birlikte kullanılmalı: FileBrowser açık kipte pek çok bileşende
    # sabit beyaz zemin kullanıyor; bunları sürüme bağlı seçicilerle zorlamak güncellemede kırılırdı.
    customThemes:
      default: { description: "Açık (Mavi)", css: "$THEMES/blue-light.css" }
      blue-dark: { description: "Koyu (Mavi) — koyu kiple kullanın", css: "$THEMES/blue-dark.css" }
      green-light: { description: "Açık (Yeşil)", css: "$THEMES/green-light.css" }
      purple-dark: { description: "Koyu (Mor) — koyu kiple kullanın", css: "$THEMES/purple-dark.css" }
      qx-classic: { description: "Classic (qooxdoo)", css: "$THEMES/qx-classic.css" }
      qx-modern: { description: "Modern (qooxdoo)", css: "$THEMES/qx-modern.css" }
      qx-simple: { description: "Simple (qooxdoo)", css: "$THEMES/qx-simple.css" }
      qx-indigo: { description: "Indigo (qooxdoo)", css: "$THEMES/qx-indigo.css" }
      qx-indigo-dark: { description: "Indigo Koyu (qooxdoo) — koyu kiple kullanın", css: "$THEMES/qx-indigo-dark.css" }
      qx-tangible-light: { description: "Tangible Açık (qooxdoo)", css: "$THEMES/qx-tangible-light.css" }
      qx-tangible-dark: { description: "Tangible Koyu (qooxdoo) — koyu kiple kullanın", css: "$THEMES/qx-tangible-dark.css" }
      fluent-light: { description: "Fluent Açık (Windows 11)", css: "$THEMES/fluent-light.css" }
      fluent-dark: { description: "Fluent Koyu (Windows 11) — koyu kiple kullanın", css: "$THEMES/fluent-dark.css" }
      silverblue: { description: "Gümüş Mavi (Windows 7 tarzı)", css: "$THEMES/silverblue.css" }
      graydient: { description: "Graydient (gri degrade)", css: "$THEMES/graydient.css" }
      darktheme: { description: "Dark (koyu degrade) — koyu kiple kullanın", css: "$THEMES/darktheme.css" }
      bernstein: { description: "Bernstein (koyu amber) — koyu kiple kullanın", css: "$THEMES/bernstein.css" }
      macos-light: { description: "macOS Açık", css: "$THEMES/macos-light.css" }
      macos-dark: { description: "macOS Koyu — koyu kiple kullanın", css: "$THEMES/macos-dark.css" }
      gnome-light: { description: "GNOME Açık (Linux)", css: "$THEMES/gnome-light.css" }
      gnome-dark: { description: "GNOME Koyu (Linux) — koyu kiple kullanın", css: "$THEMES/gnome-dark.css" }
      ubuntu: { description: "Ubuntu (Yaru, Linux)", css: "$THEMES/ubuntu.css" }
      filebrowser: { description: "FileBrowser (özgün)", css: "$THEMES/filebrowser.css" }
auth:
  # 2.x açılışta bu adla yönetici hesabı açar; varsayılan "admin" proxy başlığıyla (X-Auth-User: admin)
  # "admin" adlı bir Tiha-Mon kullanıcısına FileBrowser yöneticiliği verirdi. Hem bu ad hem eski "admin"
  # Tiha-Mon tarafında dosya yöneticisine kapalıdır (bkz. backend AuthApi::filemanager).
  adminUsername: "tihamon-fb-admin"
  methods:
    password:
      enabled: false
    proxy:
      enabled: true
      header: "X-Auth-User"
userDefaults:
  # FileBrowser'ın kendi varsayılanı koyu tema (darkMode: true); sayfa her açılışta önce bu varsayılanla
  # çizildiğinden kullanıcının açık mod tercihi "hatırlanmıyor" gibi görünüyordu. tiha-mon açık temalı.
  ui:
    darkMode: false
    # Yeni oluşturulan (ilk kez açılan) hesap tiha-mon'un varsayılan temasıyla başlasın (customThemes.default).
    customTheme: "default"
  # Dosya izinleri (görme/indirme/değiştirme…) 2.x'te kaynak başına: yukarıda defaultPermissions.
  account:
    permissions:
      api: true
      admin: false
      share: false
      realtime: false
    disableUpdateNotifications: true
YAML

cd "$APP"
exec ./filebrowser -c "$APP/config.yaml"
