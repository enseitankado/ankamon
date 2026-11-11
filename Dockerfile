# SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

# Ankamon — tek konteyner. Bütün bileşenler (PostgreSQL+TimescaleDB, rsyslog, Telegraf, Grafana,
# nginx, PHP-FPM, Python worker+Ansible, MediaMTX) tek imajda; supervisord yönetir. Dışarı açık: 80/443
# (arayüz), 514 (log), 8554 + 8189 (ekran yansıtma: tahtaların RTSP okuması, tarayıcının WebRTC medyası).

# ---------------------------------------------------------------- 1) Arayüzü derle (qooxdoo)
FROM node:24-alpine AS frontend
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
# Topluluk qooxdoo temaları (MIT): themes-src/themes.txt'teki sabit commit'lerden + ankamon yamaları.
COPY frontend/themes-src ./themes-src
RUN sh themes-src/fetch-themes.sh themes-src themes
# Ağ envanterinin MAC üretici tablosu (Wireshark manuf). İndirilemezse boş kalır (üretici adı görünmez,
# tarama çalışır); derleme durmaz.
RUN mkdir -p /out \
 && if curl -fsSL --retry 3 --retry-delay 5 https://www.wireshark.org/download/automated/data/manuf -o /tmp/manuf; \
    then gzip -9c /tmp/manuf > /out/manuf.gz; \
    else echo "UYARI: manuf indirilemedi; MAC üretici adları boş kalacak." >&2; : > /out/manuf.gz; fi
COPY frontend/Manifest.json frontend/compile.json frontend/ext-libs.js ./
COPY frontend/source ./source
# Eklentiler (ext/<ad>/, public depoda yok — bkz. ext/README.md): arayüz kısımları derlemeye katılır.
COPY ext ./ext
RUN node ext-libs.js ext
# Oturum zaman çizelgesi (ui.sessions.Timeline): vis-timeline'ın bağımlılıkları gömülü standalone
# derlemesi qooxdoo kaynağı olarak eklenir; sekme ilk açıldığında yüklenir (bkz. @asset).
RUN mkdir -p source/resource/ankamon/vis \
 && cp node_modules/vis-timeline/standalone/umd/vis-timeline-graph2d.min.js \
       node_modules/vis-timeline/styles/vis-timeline-graph2d.min.css \
       node_modules/vis-timeline/LICENSE.md source/resource/ankamon/vis/
# Sözdizimi renklendirme (SSH etkinliği ▸ komut penceresi — ui.ssh.CommandView): highlight.js (BSD-3-Clause,
# https://highlightjs.org) hazır tarayıcı derlemesi (bash/python/json … yaygın diller gömülü) + açık/koyu stil.
RUN mkdir -p source/resource/ankamon/hljs \
 && cp node_modules/@highlightjs/cdn-assets/highlight.min.js \
       node_modules/@highlightjs/cdn-assets/styles/github.min.css \
       node_modules/@highlightjs/cdn-assets/styles/github-dark.min.css \
       node_modules/@highlightjs/cdn-assets/LICENSE source/resource/ankamon/hljs/
# Sistem ▸ Yazılımlar için ön yüz kütüphanelerinin sürümleri ve MAC üretici tablosunun indirildiği gün.
RUN node -e 'const v = p => require("/src/node_modules/" + p + "/package.json").version; \
      const fs = require("fs"); const m = fs.statSync("/out/manuf.gz"); \
      fs.writeFileSync("/out/frontend-versions.json", JSON.stringify({ qooxdoo: v("@qooxdoo/framework"), \
        "vis-timeline": v("vis-timeline"), "highlight.js": v("@highlightjs/cdn-assets"), node: process.versions.node, \
        manuf: m.size > 0 ? m.mtime.toISOString().slice(0, 10) : "" }))'
RUN npx qx compile --target=build \
 && rm -rf compiled/build/transpiled compiled/build/db.json compiled/build/resource-db.json

# ---------------------------------------------------------------- 1b) Dosya yöneticisi (FileBrowser
# Quantum): resmi imajdan yalnız statik ikili + derlenmiş arayüz alınır (bkz. aşağıdaki COPY --from).
# Alpine/musl ile doğrudan uyumlu, bağımlılıksız bir Go ikili — ayrı bir derleme adımı gerekmez.
# Sürüm SABİT (digest ile). 2.1.3-beta: 1.5.x/2.0.x-stable'ı etkileyen güvenlik danışmalarının (symlink ile
# kapsam dışı okuma/yazma, XSS…) hepsini kapatan ilk sürüm; 2.1.x-stable çıkınca ona geçilir. 2.x imajında
# arayüz ikiliye gömülü DEĞİL: ikili çalışma dizinine göre internal/web/dist'i sunar (bkz. filemanager.sh).
FROM gtstef/filebrowser:2.1.4-beta@sha256:d7ae18aa7e8ff81695a35a2c1af399f0c437339241ad90be446c5e71314c0c31 AS filemanager

# ---------------------------------------------------------------- 1c) Ekran yansıtma aktarıcısı (MediaMTX):
# resmi imajdan yalnız statik Go ikilisi alınır (Alpine deposunda paketi yok). Sürüm sabit tutulur.
FROM bluenviron/mediamtx:1.21.2 AS mediamtx

# ---------------------------------------------------------------- 2) Çalışma imajı
FROM timescale/timescaledb:2.31.0-pg17

# Okul ağındaki filtre HTTPS'i kendi sertifikasıyla keser; depolar HTTP üzerinden kullanılır
# (paketler imzalı olduğundan bütünlük apk tarafından doğrulanır). pip/composer kullanılmaz.
# apk upgrade: taban imajın kendi paketleri (ör. libexpat) imaj yeniden yayımlanana dek eski kalır.
# Taban imajın eski Go ile derlenmiş, ankamon'un kullanmadığı araçları (gosu → su-exec kullanılır,
# timescaledb-tune/parallel-copy) silinir: güvenlik taramasındaki açıkların çoğu bunlardaydı.
RUN sed -i 's|https://|http://|' /etc/apk/repositories \
 && apk upgrade --no-cache \
 && rm -f /usr/local/bin/gosu /usr/local/bin/timescaledb-tune /usr/local/bin/timescaledb-parallel-copy \
 && apk add --no-cache \
      bash tzdata curl supervisor su-exec \
      nginx \
      php84 php84-fpm php84-pdo php84-pdo_pgsql php84-opcache php84-session \
      php84-ctype php84-mbstring php84-tokenizer php84-openssl php84-phar php84-curl php84-simplexml \
      grafana telegraf \
      rsyslog rsyslog-pgsql rsyslog-mmutf8fix \
      python3 py3-psycopg py3-yaml ansible-core openssh-client sshpass fping iproute2-ss \
      py3-pip py3-tornado py3-paramiko \
      sshfs openssl \
      arp-scan nmap nmap-nselibs nmap-scripts samba-client \
 && pip install --no-deps --break-system-packages --no-cache-dir webssh \
 && ln -sf /usr/bin/php84 /usr/bin/php \
 && cp /usr/share/zoneinfo/Europe/Istanbul /etc/localtime \
 && rm -f /etc/nginx/http.d/default.conf

# Ekran önizlemesinin paylaşımı: salt izlemede tahta başına tek VNC bağlantısı, Ankamon'da x11vnc -reflect
# ile bütün izleyicilere çoğaltılır (bkz. worker/ankamon/screen/shared_feed.py). Ayrı katman: üstteki büyük
# katmanın önbelleği bozulmasın.
RUN apk add --no-cache x11vnc

# webssh'in kendi eşzamanlılık hatasını düzeltir (bkz. dosyanın başındaki açıklama) — /multishell/'in
# aynı anda birden çok terminal açması bu olmadan arada bir "Websocket authentication failed" veriyordu.
COPY docker/rootfs/webssh-race-fix.py /tmp/webssh-race-fix.py
RUN python3 /tmp/webssh-race-fix.py && rm /tmp/webssh-race-fix.py
# Web terminal penceresindeki A−/A+ için canlı yazı boyutu (oturumu koparmadan) — bkz. dosyanın açıklaması.
COPY docker/rootfs/webssh-fontsize-patch.py /tmp/webssh-fontsize-patch.py
RUN python3 /tmp/webssh-fontsize-patch.py && rm /tmp/webssh-fontsize-patch.py
# Web terminal oturumlarının açılış/kapanışını webshell_sessions tablosuna yazan kanca (Oturumlar sayfası).
COPY docker/rootfs/webssh-hook.py /usr/lib/python3.12/site-packages/webssh/ankamon_hook.py
COPY docker/rootfs/webssh-hook-patch.py /tmp/webssh-hook-patch.py
RUN python3 /tmp/webssh-hook-patch.py && rm /tmp/webssh-hook-patch.py

# noVNC (tarayıcıdaki VNC istemcisi, canlı tahta ekranı): yalnız istemci JS dosyaları alınır. Paketin
# bağımlılığı websockify (+numpy…) gerekmez — akışı kendi SSH köprümüz taşır (worker/ankamon/screen).
RUN cd /tmp && apk fetch --no-cache -q novnc \
 && tar -xzf novnc-*.apk usr/share/novnc 2>/dev/null \
 && mkdir -p /var/www/screen/novnc \
 && cp -r usr/share/novnc/core usr/share/novnc/vendor /var/www/screen/novnc/ \
 && mkdir -p /opt/ankamon && ls novnc-*.apk | sed 's/^novnc-//; s/\.apk$//' > /opt/ankamon/novnc.version \
 && rm -rf /tmp/novnc-*.apk /tmp/usr

# Dosya yöneticisi (FileBrowser Quantum) ikili + derlenmiş arayüzü.
COPY --from=filemanager --chmod=755 /home/filebrowser/filebrowser /opt/ankamon/filemanager/filebrowser
COPY --from=filemanager /home/filebrowser/internal/web/dist /opt/ankamon/filemanager/dist

# Ekran yansıtma aktarıcısı (bkz. docker/rootfs/services/mediamtx.sh).
COPY --from=mediamtx --chmod=755 /mediamtx /opt/ankamon/mediamtx/mediamtx

# Yapılandırmalar
COPY docker/rootfs/nginx-default.conf /etc/nginx/http.d/default.conf
COPY docker/rootfs/nginx-filemanager-proxy.conf /etc/nginx/filemanager-proxy.conf
COPY docker/rootfs/nginx-devproxy.conf /etc/nginx/devproxy.conf.in
COPY docker/rootfs/multishell /var/www/multishell
COPY docker/rootfs/screen /var/www/screen
# Tahtaya özel SSH parolası: sshpass çağrılarının önüne geçen süzgeç (bkz. worker executor/board_password.py).
COPY --chmod=755 docker/rootfs/ankamon-sshpass.sh /usr/local/bin/sshpass
COPY docker/rootfs/cast /var/www/cast
COPY docker/rootfs/filemanager-open /var/www/filemanager-open
COPY docker/rootfs/filemanager/ankamon.css /opt/ankamon/filemanager/ankamon.css
COPY docker/rootfs/filemanager/themes /opt/ankamon/filemanager/themes
COPY docker/rootfs/php-fpm.conf /etc/php84/php-fpm.conf
COPY docker/rootfs/php.ini /etc/php84/conf.d/zz-ankamon.ini
COPY docker/rsyslog/rsyslog.conf /etc/ankamon/rsyslog.conf
COPY docker/rootfs/telegraf.conf /etc/ankamon/telegraf.conf
COPY docker/telegraf/reshape.star /etc/ankamon/reshape.star
COPY docker/grafana/provisioning /etc/ankamon/grafana/provisioning
COPY docker/grafana/dashboards /etc/ankamon/grafana/dashboards
RUN sed -i 's#/etc/grafana/dashboards#/etc/ankamon/grafana/dashboards#' \
      /etc/ankamon/grafana/provisioning/dashboards/ankamon.yml

# Uygulama, worker, göçler, yedek, hazır işlemler
COPY docker/rootfs/supervisord.conf /opt/ankamon/supervisord.conf
COPY docker/rootfs/entrypoint.sh /opt/ankamon/entrypoint.sh
COPY docker/rootfs/services /opt/ankamon/services
# MEB filtresinin HTTPS kesme kökü (CN=fatihca → MEB-CERT-ACI): yalnız dış araç güncelleyicisi
# (worker/ankamon/executor/tools.py) GitHub API bağlantısında kullanır; sistem güven deposuna eklenmez.
COPY docker/rootfs/certs /opt/ankamon/certs
COPY backend /opt/ankamon/app
COPY actions /opt/ankamon/app/actions
COPY worker /opt/ankamon/worker
# Eklentilerin sunucu/worker kısımları (backend/, worker/); yoksa yalnız ext/README.md gelir.
COPY ext /opt/ankamon/ext
COPY --from=frontend /out/manuf.gz /opt/ankamon/worker/ankamon/netscan/manuf.gz
COPY db /opt/ankamon/db
COPY docker/backup /opt/ankamon/backup
COPY --from=frontend /src/compiled/build /var/www/ankamon

RUN chmod +x /opt/ankamon/entrypoint.sh /opt/ankamon/services/*.sh \
 && ln -sf /opt/ankamon/supervisord.conf /etc/supervisord.conf

# Sistem ▸ Yazılımlar: bileşen sürümleri imaj üretilirken bir kez toplanır (bkz. docker/rootfs/software-versions.py).
COPY --from=frontend /out/frontend-versions.json /opt/ankamon/frontend-versions.json
COPY docker/rootfs/software-versions.py /tmp/software-versions.py
RUN python3 /tmp/software-versions.py && rm /tmp/software-versions.py

# Üst çubuktaki sürüm/derleme bilgisi (bkz. docker/rootfs/ankamon-surum-damgasi.py). Köşeli joker: .git yoksa
# (kaynak arşivi) ya da dosyaysa (worktree) derleme kırılmaz; Dockerfile eşleşmeyen COPY olmasın diye kaynakta.
COPY Dockerfile frontend/Manifest.json .gi[t]/HEA[D] .gi[t]/packed-ref[s] .gi[t]/refs/head[s] /tmp/ankamon-surum-kaynak/
COPY docker/rootfs/ankamon-surum-damgasi.py /tmp/ankamon-surum-damgasi.py
RUN python3 /tmp/ankamon-surum-damgasi.py /tmp/ankamon-surum-kaynak /opt/ankamon/surum-damgasi.json \
 && rm -rf /tmp/ankamon-surum-kaynak /tmp/ankamon-surum-damgasi.py

EXPOSE 80 443 514/tcp 514/udp 8554/tcp 8189/udp 8189/tcp
VOLUME /data

ENTRYPOINT ["/opt/ankamon/entrypoint.sh"]
