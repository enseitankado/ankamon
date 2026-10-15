#!/bin/sh
# Ağ envanteri tarayıcısı (bkz. worker/tihamon/netscan): bağlı fiziksel ağları ARP ile (arp-scan),
# çevrimiçi cihazların servislerini nmap ile tarar. Konteyner host ağında olduğundan gerçek
# arabirimlere erişir; ham soket için root çalışır (Docker'ın varsayılan NET_RAW yetkisi yeterli).
# Tarama sıklığı makinenin yüküne göre kendiliğinden ayarlanır, araçlar nice 19 + ionice idle ile çalışır.
set -eu

. /opt/tiha-mon/services/wait-db.sh

export PG_HOST=127.0.0.1 PG_PORT=5432 PG_DB=tihamon PG_USER=tihamon PG_PASSWORD="$POSTGRES_PASSWORD"
export PYTHONUNBUFFERED=1

cd /opt/tiha-mon/worker
exec nice -n 10 python3 -m tihamon.netscan
