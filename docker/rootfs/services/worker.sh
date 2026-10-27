#!/bin/sh
# SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

# Arka plan işçisi: tahta kaydı, erişilebilirlik yoklaması, Telegraf hedefleri ve görev yürütme (Ansible).
set -eu

. /opt/ankamon/services/wait-db.sh

export PG_HOST=127.0.0.1 PG_PORT=5432 PG_DB=ankamon PG_USER=ankamon PG_PASSWORD="$POSTGRES_PASSWORD"
export TELEGRAF_TARGETS=/data/telegraf/targets.conf
export ACTIONS_DIR=/opt/ankamon/app/actions
export PYTHONUNBUFFERED=1
# Ansible: tahtalar bilinen_hosts'a yazılmaz (imajdan çıkan anahtarlar değişir). Sonuç --tree ile
# alınır (json stdout callback ansible.posix'te, kurulu değil), bu yüzden callback ayarlanmaz.
export ANSIBLE_HOST_KEY_CHECKING=False ANSIBLE_RETRY_FILES_ENABLED=False \
    ANSIBLE_LOCAL_TEMP=/tmp/ansible

cd /opt/ankamon/worker
exec python3 -m ankamon
