#!/bin/sh
# Ekran yansıtma aktarıcısı (MediaMTX): yöneticinin tarayıcısı ekranını WebRTC/WHIP ile buraya yollar
# (nginx /cast/mtx/ → 127.0.0.1:8897, oturum + "cast" yetkisiyle), tahtalardaki mpv aynı yayını RTSP
# ile okur. Görüntü yeniden kodlanmaz, yalnız aktarılır (işlemci yükü çok düşük).
#
# Erişim kuralları:
#   - yayınlama yalnız 127.0.0.1'den (yani yalnız nginx vekili üzerinden, yetki denetiminden geçmiş);
#   - okuma yalnız "c-<rastgele 24+ karakter>" adlı yollardan — yol adını yalnız yayını başlatan sayfa
#     ve o yayının tahtaları bilir (bkz. docker/rootfs/cast/index.html, worker/ankamon/executor/cast.py).
# Dışa açık portlar: RTSP 8554/tcp (tahtalar okur), WebRTC ICE 8189/udp+tcp (tarayıcının medya akışı).
set -eu

CONF=/run/ankamon/mediamtx.yml
cat > "$CONF" <<EOF
logLevel: warn
logDestinations: [stdout]
readTimeout: 10s
writeTimeout: 10s

authMethod: internal
authInternalUsers:
  - user: any
    ips: ["127.0.0.1", "::1"]
    permissions:
      - action: publish
        path: "~^c-[A-Za-z0-9]{24,64}$"
      - action: read
      - action: api
  - user: any
    permissions:
      - action: read
        path: "~^c-[A-Za-z0-9]{24,64}$"

api: true
apiAddress: 127.0.0.1:${CAST_API_PORT:-9997}
metrics: false
pprof: false
playback: false

rtsp: true
rtspTransports: [tcp]
rtspAddress: :${CAST_RTSP_PORT:-8554}
rtmp: false
hls: false
srt: false
moq: false

webrtc: true
webrtcAddress: 127.0.0.1:${CAST_WEBRTC_PORT:-8897}
webrtcLocalUDPAddress: :${CAST_ICE_PORT:-8189}
webrtcLocalTCPAddress: :${CAST_ICE_PORT:-8189}
webrtcIPsFromInterfaces: true
# Docker köprüleri ve sanal arayüzler aday olarak sunulmasın (tarayıcı boşuna onları denemesin).
webrtcIPsFromInterfacesExcludeList: [docker0, lo]

pathDefaults:
  source: publisher
  overridePublisher: true
  maxReaders: 0

paths:
  all_others:
EOF

exec /opt/ankamon/mediamtx/mediamtx "$CONF"
