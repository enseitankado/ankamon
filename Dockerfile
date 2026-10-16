# Tiha-Mon — tek konteyner. Bütün bileşenler (PostgreSQL+TimescaleDB, rsyslog, Telegraf, Grafana,
# nginx, PHP-FPM, Python worker+Ansible, MediaMTX) tek imajda; supervisord yönetir. Dışarı açık: 80/443
# (arayüz), 514 (log), 8554 + 8189 (ekran yansıtma: tahtaların RTSP okuması, tarayıcının WebRTC medyası).

# ---------------------------------------------------------------- 1) Arayüzü derle (qooxdoo)
FROM node:22-alpine AS frontend
WORKDIR /src
# Dış kaynaklar (temalar, MAC üretici tablosu) bu GEÇİCİ aşamada kendi asıl adreslerinden indirilir.
# Okul ağındaki MEB filtresi GitHub/wireshark.org HTTPS'ini kendi kökü ile keser: o kök YALNIZ bu
# aşamada güvenilir sayılır (son imaja geçmez); filtresiz ağlarda zararsızdır. apk depoları HTTP
# (paketler imzalı).
COPY docker/rootfs/certs/meb-ca.crt /tmp/meb-ca.crt
RUN cat /tmp/meb-ca.crt >> /etc/ssl/certs/ca-certificates.crt \
 && sed -i 's|https://|http://|' /etc/apk/repositories \
 && apk add --no-cache curl patch
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
# Topluluk qooxdoo temaları (MIT): themes-src/themes.txt'teki sabit commit'lerden + tiha-mon yamaları.
COPY frontend/themes-src ./themes-src
RUN sh themes-src/fetch-themes.sh themes-src themes
# Ağ envanterinin MAC üretici tablosu (Wireshark manuf). İndirilemezse boş kalır (üretici adı görünmez,
# tarama çalışır); derleme durmaz.
RUN mkdir -p /out \
 && if curl -fsSL --retry 3 --retry-delay 5 https://www.wireshark.org/download/automated/data/manuf -o /tmp/manuf; \
    then gzip -9c /tmp/manuf > /out/manuf.gz; \
    else echo "UYARI: manuf indirilemedi; MAC üretici adları boş kalacak." >&2; : > /out/manuf.gz; fi
COPY frontend/Manifest.json frontend/compile.json ./
COPY frontend/source ./source
# Oturum zaman çizelgesi (ui.sessions.Timeline): vis-timeline'ın bağımlılıkları gömülü standalone
# derlemesi qooxdoo kaynağı olarak eklenir; sekme ilk açıldığında yüklenir (bkz. @asset).
RUN mkdir -p source/resource/tihamon/vis \
 && cp node_modules/vis-timeline/standalone/umd/vis-timeline-graph2d.min.js \
       node_modules/vis-timeline/styles/vis-timeline-graph2d.min.css \
       node_modules/vis-timeline/LICENSE.md source/resource/tihamon/vis/
RUN npx qx compile --target=build \
 && rm -rf compiled/build/transpiled compiled/build/db.json compiled/build/resource-db.json

# ---------------------------------------------------------------- 1b) Dosya yöneticisi (FileBrowser
# Quantum): resmi imajdan yalnız statik ikili + derlenmiş arayüz alınır (bkz. aşağıdaki COPY --from).
# Alpine/musl ile doğrudan uyumlu, bağımlılıksız bir Go ikili — ayrı bir derleme adımı gerekmez.
# Sürüm SABİT (digest ile): v1.5.9+ arayüzü ikiliye gömdü, /home/filebrowser/http yok ve yapılandırma
# biçimi değişti — yükseltme ayrıca denenmeli.
FROM gtstef/filebrowser:v1.5.8-stable@sha256:68455d4953bad8e984e1bc5d112ed1e9c918a0a04f104c13c9ece50790308894 AS filemanager

# ---------------------------------------------------------------- 1c) Ekran yansıtma aktarıcısı (MediaMTX):
# resmi imajdan yalnız statik Go ikilisi alınır (Alpine deposunda paketi yok). Sürüm sabit tutulur.
FROM bluenviron/mediamtx:1.21.2 AS mediamtx

# ---------------------------------------------------------------- 2) Çalışma imajı
FROM timescale/timescaledb:2.30.2-pg17

# Okul ağındaki filtre HTTPS'i kendi sertifikasıyla keser; depolar HTTP üzerinden kullanılır
# (paketler imzalı olduğundan bütünlük apk tarafından doğrulanır). pip/composer kullanılmaz.
RUN sed -i 's|https://|http://|' /etc/apk/repositories \
 && apk add --no-cache \
      bash tzdata curl supervisor su-exec \
      nginx \
      php84 php84-fpm php84-pdo php84-pdo_pgsql php84-opcache php84-session \
      php84-ctype php84-mbstring php84-tokenizer php84-openssl php84-phar php84-curl php84-simplexml \
      grafana telegraf \
      rsyslog rsyslog-pgsql rsyslog-mmutf8fix \
      python3 py3-psycopg py3-yaml ansible-core openssh-client sshpass fping \
      py3-pip py3-tornado py3-paramiko \
      sshfs openssl \
      arp-scan nmap nmap-nselibs nmap-scripts samba-client \
 && pip install --no-deps --break-system-packages --no-cache-dir webssh \
 && ln -sf /usr/bin/php84 /usr/bin/php \
 && cp /usr/share/zoneinfo/Europe/Istanbul /etc/localtime \
 && rm -f /etc/nginx/http.d/default.conf

# webssh'in kendi eşzamanlılık hatasını düzeltir (bkz. dosyanın başındaki açıklama) — /multishell/'in
# aynı anda birden çok terminal açması bu olmadan arada bir "Websocket authentication failed" veriyordu.
COPY docker/rootfs/webssh-race-fix.py /tmp/webssh-race-fix.py
RUN python3 /tmp/webssh-race-fix.py && rm /tmp/webssh-race-fix.py
# Web terminal penceresindeki A−/A+ için canlı yazı boyutu (oturumu koparmadan) — bkz. dosyanın açıklaması.
COPY docker/rootfs/webssh-fontsize-patch.py /tmp/webssh-fontsize-patch.py
RUN python3 /tmp/webssh-fontsize-patch.py && rm /tmp/webssh-fontsize-patch.py
# Web terminal oturumlarının açılış/kapanışını webshell_sessions tablosuna yazan kanca (Oturumlar sayfası).
COPY docker/rootfs/webssh-hook.py /usr/lib/python3.12/site-packages/webssh/tihamon_hook.py
COPY docker/rootfs/webssh-hook-patch.py /tmp/webssh-hook-patch.py
RUN python3 /tmp/webssh-hook-patch.py && rm /tmp/webssh-hook-patch.py

# noVNC (tarayıcıdaki VNC istemcisi, canlı tahta ekranı): yalnız istemci JS dosyaları alınır. Paketin
# bağımlılığı websockify (+numpy…) gerekmez — akışı kendi SSH köprümüz taşır (worker/tihamon/screen).
RUN cd /tmp && apk fetch --no-cache -q novnc \
 && tar -xzf novnc-*.apk usr/share/novnc 2>/dev/null \
 && mkdir -p /var/www/screen/novnc \
 && cp -r usr/share/novnc/core usr/share/novnc/vendor /var/www/screen/novnc/ \
 && rm -rf /tmp/novnc-*.apk /tmp/usr

# Dosya yöneticisi (FileBrowser Quantum) ikili + derlenmiş arayüzü.
COPY --from=filemanager --chmod=755 /home/filebrowser/filebrowser /opt/tiha-mon/filemanager/filebrowser
COPY --from=filemanager /home/filebrowser/http /opt/tiha-mon/filemanager/http

# Ekran yansıtma aktarıcısı (bkz. docker/rootfs/services/mediamtx.sh).
COPY --from=mediamtx --chmod=755 /mediamtx /opt/tiha-mon/mediamtx/mediamtx

# Yapılandırmalar
COPY docker/rootfs/nginx-default.conf /etc/nginx/http.d/default.conf
COPY docker/rootfs/multishell /var/www/multishell
COPY docker/rootfs/screen /var/www/screen
COPY docker/rootfs/cast /var/www/cast
COPY docker/rootfs/filemanager-open /var/www/filemanager-open
COPY docker/rootfs/filemanager/tihamon.css /opt/tiha-mon/filemanager/tihamon.css
COPY docker/rootfs/filemanager/themes /opt/tiha-mon/filemanager/themes
COPY docker/rootfs/php-fpm.conf /etc/php84/php-fpm.conf
COPY docker/rootfs/php.ini /etc/php84/conf.d/zz-tihamon.ini
COPY docker/rsyslog/rsyslog.conf /etc/tiha-mon/rsyslog.conf
COPY docker/rootfs/telegraf.conf /etc/tiha-mon/telegraf.conf
COPY docker/telegraf/reshape.star /etc/tiha-mon/reshape.star
COPY docker/grafana/provisioning /etc/tiha-mon/grafana/provisioning
COPY docker/grafana/dashboards /etc/tiha-mon/grafana/dashboards
RUN sed -i 's#/etc/grafana/dashboards#/etc/tiha-mon/grafana/dashboards#' \
      /etc/tiha-mon/grafana/provisioning/dashboards/tihamon.yml

# Uygulama, worker, göçler, yedek, hazır işlemler
COPY docker/rootfs/supervisord.conf /opt/tiha-mon/supervisord.conf
COPY docker/rootfs/entrypoint.sh /opt/tiha-mon/entrypoint.sh
COPY docker/rootfs/services /opt/tiha-mon/services
# MEB filtresinin HTTPS kesme kökü (CN=fatihca → MEB-CERT-ACI): yalnız dış araç güncelleyicisi
# (worker/tihamon/executor/tools.py) GitHub API bağlantısında kullanır; sistem güven deposuna eklenmez.
COPY docker/rootfs/certs /opt/tiha-mon/certs
COPY backend /opt/tiha-mon/app
COPY actions /opt/tiha-mon/app/actions
COPY worker /opt/tiha-mon/worker
COPY --from=frontend /out/manuf.gz /opt/tiha-mon/worker/tihamon/netscan/manuf.gz
COPY db /opt/tiha-mon/db
COPY docker/backup /opt/tiha-mon/backup
COPY --from=frontend /src/compiled/build /var/www/tihamon

RUN chmod +x /opt/tiha-mon/entrypoint.sh /opt/tiha-mon/services/*.sh \
 && ln -sf /opt/tiha-mon/supervisord.conf /etc/supervisord.conf

EXPOSE 80 443 514/tcp 514/udp 8554/tcp 8189/udp 8189/tcp
VOLUME /data

ENTRYPOINT ["/opt/tiha-mon/entrypoint.sh"]
