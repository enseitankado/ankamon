"""Docker imajı derlenirken çalışır: webssh'e Tiha-Mon oturum kancasının (webssh/tihamon_hook.py,
kaynağı docker/rootfs/webssh-hook.py) çağrı noktalarını ekler — web terminal oturumlarının gerçek
açılış/kapanışı Oturumlar sayfasında listelensin diye (bkz. db/migrations/011_webshell_sessions.sql).
"""

import pathlib

base = pathlib.Path("/usr/lib/python3.12/site-packages/webssh")


def patch(name, before, after):
    path = base / name
    src = path.read_text()
    assert before in src, f"webssh {name} beklenen satırı içermiyor (sürüm değişmiş olabilir): {before!r}"
    path.write_text(src.replace(before, after, 1))


# WebSocket worker'a iliştiği an = oturum gerçekten başladı.
patch(
    "handler.py",
    "                self.loop.add_handler(worker.fd, worker, IOLoop.READ)\n",
    "                self.loop.add_handler(worker.fd, worker, IOLoop.READ)\n"
    "                tihamon_hook.opened(worker)  # tiha-mon\n",
)
patch("handler.py", "import tornado.web\n", "import tornado.web\nfrom webssh import tihamon_hook  # tiha-mon\n")

# Worker kapanışı (pencere kapandı, exit, bağlantı koptu — hepsi buradan geçer).
patch(
    "worker.py",
    "        self.closed = True\n",
    "        self.closed = True\n"
    "        tihamon_hook.closed(self)  # tiha-mon\n",
)
patch("worker.py", "import logging\n", "import logging\nfrom webssh import tihamon_hook  # tiha-mon\n")

print("tiha-mon: webssh oturum kancası eklendi")
