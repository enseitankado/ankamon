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

# Grafana: sensör grafikleri. Durumunu da Postgres'te tutar; oturum nginx auth_request ile devralınır.
# Yapılandırmanın tamamı ortam değişkenleriyle (GF_*) verilir.
set -eu

. /opt/ankamon/services/wait-db.sh

export \
    GF_PATHS_DATA=/data/grafana \
    GF_PATHS_PROVISIONING=/etc/ankamon/grafana/provisioning \
    GF_SERVER_HTTP_ADDR=127.0.0.1 \
    GF_SERVER_HTTP_PORT=3000 \
    GF_SERVER_ROOT_URL="http://localhost/grafana/" \
    GF_SERVER_SERVE_FROM_SUB_PATH=true \
    GF_DATABASE_TYPE=postgres \
    GF_DATABASE_HOST=127.0.0.1:5432 \
    GF_DATABASE_NAME=grafana \
    GF_DATABASE_USER=grafana \
    GF_DATABASE_PASSWORD="$PG_GRAFANA_PASSWORD" \
    GF_DATABASE_SSL_MODE=disable \
    GF_SECURITY_ADMIN_USER=etapadmin \
    GF_SECURITY_ADMIN_PASSWORD="$GRAFANA_ADMIN_PASSWORD" \
    GF_SECURITY_ALLOW_EMBEDDING=true \
    GF_AUTH_PROXY_ENABLED=true \
    GF_AUTH_PROXY_HEADER_NAME=X-WEBAUTH-USER \
    GF_AUTH_PROXY_HEADER_PROPERTY=username \
    GF_AUTH_PROXY_AUTO_SIGN_UP=true \
    GF_AUTH_PROXY_HEADERS=Role:X-WEBAUTH-ROLE \
    GF_AUTH_DISABLE_LOGIN_FORM=true \
    GF_AUTH_DISABLE_SIGNOUT_MENU=true \
    GF_USERS_ALLOW_SIGN_UP=false \
    GF_USERS_DEFAULT_THEME=light \
    GF_USERS_DEFAULT_LANGUAGE=tr-TR \
    GF_ANALYTICS_REPORTING_ENABLED=false \
    GF_ANALYTICS_CHECK_FOR_UPDATES=false \
    GF_ANALYTICS_CHECK_FOR_PLUGIN_UPDATES=false \
    GF_NEWS_NEWS_FEED_ENABLED=false \
    GF_PLUGINS_PREINSTALL_DISABLED=true \
    GF_DASHBOARDS_DEFAULT_HOME_DASHBOARD_PATH=/etc/ankamon/grafana/dashboards/tahta-genel-bakis.json \
    ANKAMON_RO_PASSWORD="$PG_READONLY_PASSWORD"

# Eski ad artığı (tihamon -> ankamon): eski panolar sahipsiz provisioning temizliğiyle silinince "Tiha-Mon"
# klasörü boş kalır; Grafana açıldıktan sonra boşsa kaldırılır (içinde kullanıcı panosu varsa dokunulmaz).
# Klasör yoksa hiçbir şey yapmaz. Kimlik: auth proxy başlığı (yalnız 127.0.0.1'den erişilebilir).
python3 - <<'PY' >/dev/null 2>&1 &
import json, time, urllib.request
API = "http://127.0.0.1:3000/api"
def call(path, method="GET"):
    req = urllib.request.Request(API + path, method=method, headers={"X-WEBAUTH-USER": "etapadmin"})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read() or b"null")
for _ in range(20):
    time.sleep(15)
    try:
        old = [f for f in call("/folders") if f.get("title") == "Tiha-Mon"]
        if not old:
            break
        if all(not call("/search?folderUIDs=" + f["uid"]) for f in old):
            for f in old:
                call("/folders/" + f["uid"], "DELETE")
            break
    except Exception:
        pass
PY

exec grafana server --homepath=/usr/share/grafana --config=/etc/grafana.ini
