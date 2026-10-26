"""Anomali: tahta açık ama oturum açılmamış (en az THRESHOLD boyunca).

Tahtanın açık aralıkları (board_uptime, loglardan) eksi kullanıcı oturumları (board_sessions) = tahtanın
kimse oturum açmadan çalıştığı süreler; THRESHOLD'dan uzun olanlar anomalidir. İki biçimi vardır
(detail.reason): "boot" — açılıştan beri oturum açılmadı; "logout" — son oturum kapandı, tahta açık kaldı.
Ekran kilidindeki oturum açık sayılır (kullanıcı oradadır).

Sürüyor (ended_at None): tahtanın son açık aralığı hâlâ açıksa (board_uptime işlenmiş en yeni log
zamanına GAP'ten yakın; UptimeApi ile aynı ölçüt) ve SSH yoklaması (boards.session_username, 30 sn'de
bir) o an oturum görmüyorsa. Yoklama oturum görüp log henüz işlenmediyse anomali şimdilik "bitti"
sayılır; oturum kaydı gelince bitiş, oturumun başlangıcına çekilir.

Yalnız Tahtalar'a kayıtlı bilgisayarlar (hostname eşleşmesi) değerlendirilir: oturum kaydı tutulmayan
sunucu/PC'ler sürekli "oturumsuz" görünürdü.
"""

import datetime

KIND = "no_login"
THRESHOLD = datetime.timedelta(minutes=15)
# worker/ankamon/tasks/board_uptime.py GAP ile aynı.
GAP = datetime.timedelta(minutes=15)
# Yoklama sonucunun taze sayıldığı süre (session_probe 30 sn'de bir; SessionsApi ile aynı).
PROBE_FRESH = datetime.timedelta(minutes=5)
_FAR = datetime.datetime(9999, 1, 1, tzinfo=datetime.timezone.utc)

_INTERVALS = """
    SELECT u.host, u.started_at, u.last_at, b.id AS board_id, b.name AS board_name,
           b.session_username, b.session_checked_at
    FROM board_uptime u
    JOIN LATERAL (
        SELECT id, COALESCE(NULLIF(label, ''), hostname, host(ip)) AS name, session_username, session_checked_at
        FROM boards WHERE lower(hostname) = lower(u.host) ORDER BY id LIMIT 1
    ) b ON true
    WHERE u.last_at >= %s
    ORDER BY u.host, u.started_at
"""

_SESSIONS = """
    SELECT host, username, started_at, ended_at
    FROM board_sessions
    WHERE host = ANY(%s) AND (ended_at IS NULL OR ended_at >= %s)
    ORDER BY host, started_at
"""


def detect(conn, since):
    now = conn.execute("SELECT now() AS now").fetchone()["now"]
    wm = conn.execute("SELECT value FROM task_cursors WHERE name = 'board_uptime.watermark'").fetchone()
    watermark = wm["value"] if wm else None
    fresh = watermark is not None and now - watermark <= GAP

    intervals = conn.execute(_INTERVALS, (since,)).fetchall()
    if not intervals:
        return [], []
    sessions = {}
    oldest = min(i["started_at"] for i in intervals)
    for s in conn.execute(_SESSIONS, (list({i["host"] for i in intervals}), oldest)).fetchall():
        sessions.setdefault(s["host"], []).append(s)

    # Her host'un sonuncusu (sorgu sıralı) tek "sürüyor olabilir" aralık.
    last = {i["host"]: idx for idx, i in enumerate(intervals)}
    found, scopes = [], []
    for idx, iv in enumerate(intervals):
        host, start = iv["host"], iv["started_at"]
        ongoing = last[host] == idx and fresh and watermark - iv["last_at"] <= GAP
        end = now if ongoing else iv["last_at"]
        live_session = (iv["session_username"] is not None and iv["session_checked_at"] is not None
                        and now - iv["session_checked_at"] <= PROBE_FRESH)
        scopes.append((host, start, end))

        def add(gap_start, gap_end, detail, is_open=False):
            if gap_end - gap_start >= THRESHOLD:
                found.append({"host": host, "board_id": iv["board_id"], "board_name": iv["board_name"] or host,
                              "started_at": gap_start, "ended_at": None if is_open else gap_end,
                              "detail": dict(detail, threshold_min=int(THRESHOLD.total_seconds() // 60))})

        cursor, detail = start, {"reason": "boot"}
        for s in sessions.get(host, []):
            s_end = s["ended_at"] or _FAR
            if s_end <= start or s["started_at"] >= end:
                continue  # bu açık aralıkla örtüşmüyor
            if s["started_at"] > cursor:
                add(cursor, s["started_at"], detail)
            if s_end > cursor:
                cursor = s_end
                detail = {"reason": "logout", "user": s["username"]}
        if cursor < end:
            add(cursor, end, detail, is_open=ongoing and not live_session)
    return found, scopes


# --- Anlık tarama (bkz. anomaly.scan) ----------------------------------------------------------------------
# Açık kullanıcı oturumları whoami ile aynı ölçütle (uid 1000 < uid < 60000 süreci olan kullanıcılar; kilitli
# oturum da açık sayılır) ve açılıştan beri geçen süre.
PROBE = r"""
echo "users=$(LC_ALL=C ps -eo uid=,user:64= | awk '$1 > 1000 && $1 < 60000 { u[$2] = 1 } END { for (k in u) printf "%s ", k }')"
echo "uptime=$(cut -d' ' -f1 /proc/uptime)"
"""

_LAST_LOGOUT = """
SELECT extract(epoch FROM max(ended_at)) AS at FROM board_sessions
WHERE lower(host) = lower(%s) AND ended_at IS NOT NULL
"""


def evaluate(values: dict, ctx: dict) -> dict:
    """PROBE çıktısı → {"anomaly", "summary", "detail"}. Oturum yoksa boşta geçen süre: açılıştan ya da
    (açılıştan sonraysa) son oturumun kapanışından beri (board_sessions)."""
    users = values.get("users", "").split()
    try:
        uptime = float(values.get("uptime", ""))
    except ValueError:
        return {"anomaly": None, "summary": "Açık kalma süresi okunamadı", "detail": {}}
    threshold = int(THRESHOLD.total_seconds() // 60)
    if users:
        return {"anomaly": False, "summary": "Oturum açık: " + ", ".join(sorted(users)),
                "detail": {"users": sorted(users)}}
    now = ctx["t1"]
    idle_since, reason = now - uptime, "boot"
    host = (ctx.get("board") or {}).get("hostname")
    if host and ctx.get("conn") is not None:
        row = ctx["conn"].execute(_LAST_LOGOUT, (host,)).fetchone()
        if row and row["at"] is not None and float(row["at"]) > idle_since:
            idle_since, reason = float(row["at"]), "logout"
    idle_min = int((now - idle_since) // 60)
    since = "açılıştan beri" if reason == "boot" else "son oturum kapandıktan sonra"
    detail = {"reason": reason, "idle_min": idle_min, "threshold_min": threshold}
    if idle_min >= threshold:
        return {"anomaly": True, "summary": f"Oturum yok: {since} {idle_min} dk açık", "detail": detail}
    return {"anomaly": False, "summary": f"Oturum yok, {since} {idle_min} dk (eşik {threshold} dk)", "detail": detail}
