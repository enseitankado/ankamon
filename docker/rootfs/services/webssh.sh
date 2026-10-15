#!/bin/sh
# Web terminal (webssh): tarayıcıdan seçili tahtaya SSH. nginx /webshell/ ile vekillenir ve
# oturum + "shell" yetkisiyle korunur. Yalnız 127.0.0.1 dinler; dışarı açılmaz.
set -eu

# Oturum kancası (webssh/tihamon_hook.py) açılışta veritabanına yazar — veritabanı hazır olmalı.
. /opt/tiha-mon/services/wait-db.sh
export PG_HOST=127.0.0.1 PG_PORT=5432 PG_DB=tihamon PG_USER=tihamon PG_PASSWORD="$POSTGRES_PASSWORD"

# --policy=autoadd: imajdan çıkan tahtaların anahtarları değiştiği için bilinmeyen anahtar eklenir.
# --fbidhttp=False: parola HTTP üzerinden iletilebilir (okul iç ağı, TLS yok; nginx ardında).
# --origin=same: WebSocket kökeni istekle aynı host olmalı (nginx Host ve Origin'i aynen iletir);
# wildcard yalnız debug kipinde kabul edilir. Erişim ayrıca nginx auth_request ile kısıtlıdır.
# --xsrf=False: webssh'in kendi Tornado XSRF çerezi, aynı sayfada (çoklu terminal — /multishell/)
# birden fazla panonun AYNI ANDA açtığı istekler arasında yarışıp "XSRF cookie does not match"
# hatasıyla bağlantıyı düşürüyordu. Gereksiz bir koruma: buraya zaten nginx'in auth_request'i
# (oturum + "shell" yetkisi) dışında kimse erişemiyor; webssh'in kendi formu bizim ürettiğimiz
# güvenilir parametrelerle dolduruluyor, üçüncü taraf form gönderimi riski yok.
# --delay=10: webssh, SSH bağlantısı kurulduktan sonra WebSocket'i varsayılan 3 sn içinde
# "iliştirmezse" worker'ı geri alır ("Websocket authentication failed"). /multishell/ aynı anda
# birkaç iframe'in tamamını (HTML+JS+bağlantı) yüklediği için, özellikle yavaş bir makinede/ağda
# bu süre tüm panolar için yetmeyebiliyordu; 10 sn'ye çıkarmak payı artırır.
exec wssh \
    --address=127.0.0.1 \
    --port=8889 \
    --policy=autoadd \
    --origin=same \
    --fbidhttp=False \
    --xheaders=True \
    --xsrf=False \
    --delay=10
