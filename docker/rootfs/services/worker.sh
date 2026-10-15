#!/bin/sh
# Arka plan işçisi: tahta kaydı, erişilebilirlik yoklaması, Telegraf hedefleri ve görev yürütme (Ansible).
set -eu

. /opt/tiha-mon/services/wait-db.sh

export PG_HOST=127.0.0.1 PG_PORT=5432 PG_DB=tihamon PG_USER=tihamon PG_PASSWORD="$POSTGRES_PASSWORD"
export TELEGRAF_TARGETS=/data/telegraf/targets.conf
export ACTIONS_DIR=/opt/tiha-mon/app/actions
export PYTHONUNBUFFERED=1
# Ansible: tahtalar bilinen_hosts'a yazılmaz (imajdan çıkan anahtarlar değişir). Sonuç --tree ile
# alınır (json stdout callback ansible.posix'te, kurulu değil), bu yüzden callback ayarlanmaz.
export ANSIBLE_HOST_KEY_CHECKING=False ANSIBLE_RETRY_FILES_ENABLED=False \
    ANSIBLE_LOCAL_TEMP=/tmp/ansible

cd /opt/tiha-mon/worker
exec python3 -m tihamon
