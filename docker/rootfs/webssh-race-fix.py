# SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Docker imajı derlenirken çalışır: webssh'in handler.py'ındaki eşzamanlılık hatasını düzeltir.

Hata: POST işleyicisi `workers = clients.get(ip, {})` ile BOŞ bir yerel sözlük alır (henüz
`clients[ip]`'e yazılmamış), sonra `yield future` ile SSH bağlantısı kurulana kadar askıya alınır.
Aynı istemci IP'sinden (tek sayfadaki birden çok iframe — /multishell/ — hep aynı IP) iki istek
üst üste gelirse, ikisi de "workers" için AYRI birer boş sözlük alır; hangisi önce biterse
`clients[ip] = workers` ile kendi sözlüğünü yazar, sonra geç biten isteğin `clients[ip] = workers`
ataması önce yazılanı SİLER. Önce biten isteğin worker'ı artık `clients[ip]` altında bulunamaz;
o panonun WebSocket'i açılınca "Websocket authentication failed" ile reddedilir.

Düzeltme: `clients.setdefault(ip, {})` ile sözlüğü `yield`'den ÖNCE, tek seferde oluştur/al — aynı
IP'den gelen eşzamanlı istekler aynı sözlük nesnesini paylaşır, yarış ortadan kalkar.
"""

import pathlib

path = pathlib.Path("/usr/lib/python3.12/site-packages/webssh/handler.py")
src = path.read_text()

before = "        workers = clients.get(ip, {})"
after = "        workers = clients.setdefault(ip, {})  # ankamon: atomik al/oluştur, yarış durumunu önler"
assert before in src, "webssh handler.py beklenen satırı içermiyor (sürüm değişmiş olabilir)"
src = src.replace(before, after, 1)

before2 = "        else:\n            if not workers:\n                clients[ip] = workers\n            worker.src_addr"
after2 = "        else:\n            worker.src_addr"
assert before2 in src, "webssh handler.py'daki artık gereksiz 'if not workers' bloğu bulunamadı"
src = src.replace(before2, after2, 1)

path.write_text(src)
print("ankamon: webssh handler.py yarış durumu düzeltmesi uygulandı")
