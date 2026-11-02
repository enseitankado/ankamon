#!/bin/sh
# SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

# Tahtaya özel SSH parolası: konteynerdeki bütün "sshpass -e ssh|sftp … kullanıcı@ip" çağrıları PATH'te önce buraya
# gelir. O adres için kayıt varsa (/run/ankamon/board-ssh/<ip>, worker executor/board_password.py yazar) parola onunla
# değişir; yoksa çağıranın verdiği genel parola (Ayarlar ▸ SSH erişimi) kalır.
for a in "$@"; do
    case "$a" in
        *[!a-zA-Z0-9_.@-]*) continue ;;
        *@*.*.*.*)
            f="/run/ankamon/board-ssh/${a#*@}"
            if [ -r "$f" ]; then
                SSHPASS=$(cat "$f")
                export SSHPASS
            fi
            break ;;
    esac
done
exec /usr/bin/sshpass "$@"
