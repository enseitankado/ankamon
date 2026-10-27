# SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

FROM alpine:3.24

# Depolar HTTP üzerinden: okul ağındaki filtre HTTPS'i kendi sertifikasıyla araya girerek keser,
# konteyner o sertifikayı tanımaz. Paketler imzalı olduğundan bütünlük apk tarafından doğrulanır.
RUN sed -i 's|https://|http://|' /etc/apk/repositories \
 && apk add --no-cache rsyslog rsyslog-pgsql rsyslog-mmutf8fix tzdata

COPY rsyslog.conf /etc/rsyslog.conf
COPY --chmod=755 entrypoint.sh /entrypoint.sh

EXPOSE 514/tcp 514/udp
VOLUME /var/spool/rsyslog

# Disk kuyruğu öldürülmeye dayanıklıdır (her kayıtta denetim noktası). Düzgün kapanışta ise rsyslog,
# veritabanı erişilemezken denemekte olduğu partiyi iptal edip kaybeder; bu yüzden doğrudan öldürülür.
STOPSIGNAL SIGKILL

CMD ["/entrypoint.sh"]
