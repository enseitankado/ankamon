"""Ekran köprüsü: ws://127.0.0.1:8890/screen/ws/<tahta id>?q=view|thumb (nginx /screen/ws/ vekiller).

Her WebSocket bağlantısı için önce tahtada x11vnc başlatılır (remote.start_command), sonra
`ssh -W 127.0.0.1:<port>` tüneli açılır; tünelin stdout'u WebSocket'e, tarayıcıdan gelen baytlar
tünelin stdin'ine yazılır. Yetki nginx auth_request'te (oturum + "screen") denetlenir; köprü yalnız
127.0.0.1'i dinler. `control=1` (fare/klavye ile müdahale) yalnız nginx'in oturumdan doldurduğu
X-Auth-Control: 1 başlığı varsa ("screen.control" yetkisi) kabul edilir; yoksa 4030 ile kapanır.
Tek tahta izleme ve müdahale oturumları komut loglarına (source=screen) ve etkinlik günlüğüne yazılır.

Kapanış kodları (tarayıcıdaki /screen/ sayfası bunları Türkçe iletiye çevirir):
  4001 tahta yok/IP'si yok · 4002 SSH ile ulaşılamadı · 4003 SSH girişi reddedildi
  4004 tahtada x11vnc kurulu değil (otomatik kurulum kapalı) · 4005 x11vnc hatası
  4006 x11vnc otomatik kuruluyor ("job <id>") · 4007 otomatik kurulum yakın zamanda başarısız oldu
  4029 eşzamanlı izleme sınırı aşıldı · 4030 müdahale yetkisi yok
"""

from __future__ import annotations

import asyncio
import logging
import os

import tornado.web
import tornado.websocket
from psycopg.types.json import Jsonb

from .. import activity, db
from ..executor.jobs import _board_access
from . import perf, remote, taskmgr

log = logging.getLogger("ankamon.screen")

PORT = int(os.environ.get("SCREEN_PORT", "8890"))
# Aynı anda açık akış sınırı: her akış bu makinede bir ssh süreci (~5 MB) demektir.
MAX_STREAMS = int(os.environ.get("SCREEN_MAX_STREAMS", "64"))

_SSH_OPTS = [
    "-T",
    "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", "-o", "LogLevel=ERROR",
    "-o", "ConnectTimeout=8", "-o", "ServerAliveInterval=20", "-o", "ServerAliveCountMax=3",
    # RFB (tight/JPEG) zaten sıkıştırılmış; SSH sıkıştırması yalnız işlemci harcar.
    "-o", "Compression=no",
    "-o", "PubkeyAuthentication=no", "-o", "PreferredAuthentications=password,keyboard-interactive",
]

_streams = 0


def _lookup(board_id: int):
    """Tahta adresi + SSH erişimi."""
    with db.connect() as conn:
        board = conn.execute(
            "SELECT host(ip) AS ip, coalesce(nullif(label, ''), hostname, host(ip)) AS name FROM boards WHERE id = %s",
            (board_id,),
        ).fetchone()
        if not board or not board["ip"]:
            return None
        ssh_user, password = _board_access(conn)
        return board, ssh_user, password


def _record(board_id: int, name: str, user: str, control: bool) -> None:
    """Başarıyla açılan tek tahta izleme/müdahale oturumunu komut loglarına ve etkinlik günlüğüne yazar."""
    what = "ekran yönetimi (fare/klavye) oturumu açıldı" if control else "ekran izleme oturumu açıldı"
    with db.connect() as conn:
        conn.execute(
            "INSERT INTO command_log (board_id, board_name, username, source, command, status)"
            " VALUES (%s, %s, %s, 'screen', %s, 'ok')",
            (board_id, name, user, what),
        )
        activity.record(conn, f"{'Ekran yönetimi' if control else 'Ekran izleme'}: {user} → {name}",
                        "warn" if control else "info")


VNC_ACTION = "vnc-install"          # actions/vnc-install — "Ekran istemcisini (x11vnc) kur"
VNC_RETRY_AFTER_FAIL_MIN = 10       # başarısız otomatik kurulum bu kadar dakika yeniden denenmez


def _autoinstall(board_id: int, name: str, username: str) -> tuple[int, str]:
    """Tahtada x11vnc yok (4004): ayar açıksa kurulumu arka plan görevi olarak başlatır.

    Döner: (4006, "job <id>") kurulum sürüyor/başlatıldı · (4007, "job <id>") son
    VNC_RETRY_AFTER_FAIL_MIN dakikada başarısız olmuş (sonsuz döngüye girmesin) · (4004, ...) ayar kapalı.
    Aynı tahtanın onlarca kutucuğu aynı anda buraya gelebilir: görev tahta başına danışma kilidi
    altında, tek transaction'da açılır — yinelenen kurulum olmaz. Görev olağan "action" görevidir
    (runner çalıştırır; Görevler/komut loglarında görünür) ama arayüzde çıktı penceresi açılmaz.
    """
    with db.connect() as conn:
        row = conn.execute("SELECT value FROM settings WHERE key = 'screen_vnc_autoinstall'").fetchone()
        if row is not None and row["value"] is False:
            return 4004, "x11vnc"
        with conn.transaction():
            conn.execute("SELECT pg_advisory_xact_lock(hashtext('screen.vnc-install'), %s)", (board_id,))
            last = conn.execute(
                """SELECT j.id, t.status, j.finished_at > now() - make_interval(mins => %s) AS recent
                   FROM jobs j JOIN job_targets t ON t.job_id = j.id
                   WHERE j.type = 'action' AND j.params->>'action' = %s AND t.board_id = %s
                   ORDER BY j.id DESC LIMIT 1""",
                (VNC_RETRY_AFTER_FAIL_MIN, VNC_ACTION, board_id)).fetchone()
            if last and last["status"] in ("queued", "running"):
                return 4006, f"job {last['id']}"
            if last and last["status"] in ("failed", "unreachable") and last["recent"]:
                return 4007, f"job {last['id']}"
            user = conn.execute("SELECT id FROM users WHERE username = %s", (username,)).fetchone()
            job_id = conn.execute(
                """INSERT INTO jobs (type, title, params, created_by)
                   VALUES ('action', 'Ekran istemcisini (x11vnc) kur — otomatik', %s, %s) RETURNING id""",
                (Jsonb({"action": VNC_ACTION, "values": {}, "auto": True}), user["id"] if user else None),
            ).fetchone()["id"]
            conn.execute("INSERT INTO job_targets (job_id, board_id) VALUES (%s, %s)", (job_id, board_id))
            conn.execute("SELECT pg_notify('ankamon_jobs', %s)", (str(job_id),))
            activity.record(conn, f"Ekranlar: {name} tahtasında x11vnc yok — ekran istemcisi otomatik kuruluyor")
    log.info("%s: x11vnc yok, otomatik kurulum görevi #%s başlatıldı", name, job_id)
    return 4006, f"job {job_id}"


class ScreenSocket(tornado.websocket.WebSocketHandler):
    proc: asyncio.subprocess.Process | None = None
    counted = False

    async def open(self, board_id: str):
        global _streams
        self.set_nodelay(True)
        if _streams >= MAX_STREAMS:
            self.close(4029, "limit")
            return
        _streams += 1
        self.counted = True

        profile = self.get_argument("q", "view")
        if profile not in remote.PROFILES:
            profile = "view"
        user = self.request.headers.get("X-Auth-User", "?")
        control = self.get_argument("control", "0") == "1"
        if control and self.request.headers.get("X-Auth-Control") != "1":
            self.close(4030, "control")
            return
        if control:
            profile = "view"
        found = await asyncio.to_thread(_lookup, int(board_id))
        if found is None:
            self.close(4001, "board")
            return
        board, ssh_user, password = found
        env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "SSHPASS": password}
        target = f"{ssh_user}@{board['ip']}"

        # 1) x11vnc'yi tahtanın 127.0.0.1'inde başlat, portunu öğren.
        start = await asyncio.create_subprocess_exec(
            "sshpass", "-e", "ssh", *_SSH_OPTS, target, remote.start_command(profile, control),
            stdin=asyncio.subprocess.DEVNULL, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            env=env,
        )
        try:
            out, err = await asyncio.wait_for(start.communicate(), timeout=30)
        except asyncio.TimeoutError:
            start.kill()
            self.close(4002, "timeout")
            return
        port = remote.parse_port(out.decode(errors="replace"))
        if start.returncode != 0 or port is None:
            err_text = err.decode(errors="replace").strip()
            code, reason = self._close_reason(start.returncode or 4, err_text)
            if code == 4004:
                # Tahta ağda ve SSH çalışıyor ama x11vnc yok: ayara göre arka planda kur (bkz. _autoinstall).
                code, reason = await asyncio.to_thread(_autoinstall, int(board_id), board["name"], user)
            else:
                log.info("%s: ekran paylaşımı başlatılamadı (çıkış %s): %s", board["name"], start.returncode, err_text[-200:])
            self.close(code, reason)
            return
        if self.ws_connection is None:  # tarayıcı bu arada kapattı; x11vnc -timeout ile kendisi biter
            return
        # Önizleme kutucukları (onlarca tahta) günlüğü doldurmasın; yalnız tek tahta izlemesi ve
        # müdahale yazılır — ve yalnız ekran paylaşımı gerçekten başladıysa (başarısız denemeler değil).
        # nolog=1: Tahtalar sayfasının "Ekranlar" önizleme sekmesi (kullanıcı isteği: önizleme komut
        # loguna yansımaz — oradan tam ekrana büyütülen kutucuk da). Müdahale her durumda yazılır.
        nolog = self.get_argument("nolog", "0") == "1"
        if control or (profile == "view" and not nolog):
            await asyncio.to_thread(_record, int(board_id), board["name"], user, control)

        # 2) Standart SSH tüneli: stdin/stdout doğrudan x11vnc'nin TCP bağlantısıdır.
        self.proc = await asyncio.create_subprocess_exec(
            "sshpass", "-e", "ssh", *_SSH_OPTS, "-W", f"127.0.0.1:{port}", target,
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            env=env,
        )
        asyncio.ensure_future(self._pump(board["name"]))

    async def _pump(self, name: str):
        """SSH stdout → WebSocket. write_message beklenir: yavaş istemci akışı doğal olarak frenler."""
        proc = self.proc
        sent = 0
        try:
            while True:
                data = await proc.stdout.read(65536)
                if not data:
                    break
                sent += len(data)
                await self.write_message(data, binary=True)
        except tornado.websocket.WebSocketClosedError:
            pass
        finally:
            rc = await proc.wait()
            err = (await proc.stderr.read()).decode(errors="replace").strip()
        if self.ws_connection is None:  # istemci kapattı; olağan son
            return
        code, reason = self._close_reason(rc, err)
        if code != 1000:
            log.info("%s: akış bitti (çıkış %s, %d bayt): %s", name, rc, sent, err[-200:])
        self.close(code, reason)

    @staticmethod
    def _close_reason(rc: int, err: str) -> tuple[int, str]:
        if rc == 0:
            return 1000, ""
        if rc == remote.EXIT_NO_X11VNC:
            return 4004, "x11vnc"
        if rc == remote.EXIT_START_FAILED:
            hint = err.splitlines()[-1] if err else "x11vnc"
            return 4005, hint.encode("ascii", "replace").decode()[:100]
        if rc in (5, 6):  # sshpass: parola reddedildi / anahtar sorunu
            return 4003, "auth"
        if rc == 255:
            return 4002, "ssh"
        # Kısa, ASCII bir ipucu (kapanış nedeni 123 baytla sınırlı).
        hint = err.splitlines()[-1] if err else f"exit {rc}"
        return 4005, hint.encode("ascii", "replace").decode()[:100]

    def on_message(self, message):
        proc = self.proc
        if proc and proc.returncode is None and proc.stdin and not proc.stdin.is_closing():
            proc.stdin.write(message if isinstance(message, bytes) else message.encode())

    def on_close(self):
        global _streams
        if self.counted:
            self.counted = False
            _streams -= 1
        proc = self.proc
        if proc and proc.returncode is None:
            proc.kill()  # SSH kapanınca tahtadaki x11vnc stdin'i kapanır ve kendiliğinden çıkar


async def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    app = tornado.web.Application(
        [(r"/screen/ws/(\d+)", ScreenSocket),
         # Ekranlar sekmesinin "Başarım" görünümü (htop üst panelleri, saniyelik) — bkz. perf.py.
         (r"/screen/ws/perf/(\d+)", perf.PerfSocket, {"lookup": _lookup, "ssh_opts": _SSH_OPTS}),
         # Tahtalar/Ekranlar sağ menüsü "Görev yöneticisi" (canlı SSH + tahtada ajan) — bkz. taskmgr.py.
         (r"/screen/ws/taskmgr/(\d+)", taskmgr.TaskMgrSocket, {"lookup": _lookup, "ssh_opts": _SSH_OPTS})],
        # Ölü tarayıcı bağlantıları (sekme çökmesi, ağ kopması) ssh süreçlerini sonsuza dek tutmasın.
        websocket_ping_interval=30,
        websocket_ping_timeout=60,
    )
    app.listen(PORT, address="127.0.0.1", xheaders=True)
    log.info("ekran köprüsü 127.0.0.1:%d (en çok %d akış)", PORT, MAX_STREAMS)
    await asyncio.Event().wait()


if __name__ == "__main__":
    asyncio.run(main())
