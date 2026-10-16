<?php
declare(strict_types=1);

namespace Tihamon\Api;

use Tihamon\Core\Auth;
use Tihamon\Core\Db;
use Tihamon\Core\Request;

/**
 * Tiha-Mon'un KENDİ kullanıcılarının oturum geçmişi (login_sessions, göç 019) — tahtalardaki kullanıcı
 * oturumları (board_sessions, "sessions.*" yetkileri) DEĞİL. Kullanıcılar ▸ Oturumlar sekmesi ve alt
 * çubuktaki "oturum açmış kullanıcılar" göstergesi kullanır. Ayrıntı 'logins' yetkisi ister; alt çubuk
 * sayısı her oturum sahibine açıktır (bkz. active()).
 */
final class LoginSessionsApi
{
    /** Son etkinliği bundan eski oturum "boşta" sayılır (açık sekme alt çubukla saniyede bir istek atar). */
    private const IDLE_MINUTES = 5;

    /** Oturum durumu: active (geçerli), logout / revoked / expired (bitti). */
    private const STATUS = "CASE WHEN ls.ended_at IS NOT NULL THEN ls.end_reason
                                 WHEN ls.expires_at IS NOT NULL AND ls.expires_at <= now() THEN 'expired'
                                 WHEN s.id IS NULL THEN 'revoked'
                                 ELSE 'active' END";

    public function index(Request $request): array
    {
        $days = $request->queryInt('days', 30, 1, 365);
        $limit = $request->queryInt('limit', 2000, 1, 10000);
        $status = self::STATUS;
        $rows = Db::all(
            "SELECT ls.id, ls.username, u.full_name, ls.ip, ls.user_agent,
                    (extract(epoch FROM ls.started_at) * 1000)::bigint AS started_ts,
                    (extract(epoch FROM ls.last_seen_at) * 1000)::bigint AS last_seen_ts,
                    (extract(epoch FROM coalesce(ls.ended_at, CASE WHEN ls.expires_at <= now() THEN ls.expires_at END)) * 1000)::bigint AS ended_ts,
                    $status AS status,
                    (SELECT count(*) FROM audit_log a WHERE a.login_session_id = ls.id) AS actions,
                    (SELECT string_agg(DISTINCT a.action, ', ' ORDER BY a.action) FROM audit_log a
                      WHERE a.login_session_id = ls.id AND a.action NOT IN ('login', 'logout')) AS action_names
             FROM login_sessions ls
             LEFT JOIN sessions s ON s.id = ls.session_hash
             LEFT JOIN users u ON u.id = ls.user_id
             WHERE ls.started_at > now() - make_interval(days => ?)
             ORDER BY ls.started_at DESC LIMIT $limit",
            [$days]
        );
        return ['sessions' => $rows, 'idle_minutes' => self::IDLE_MINUTES];
    }

    /** Bir oturumda yapılan işlemler (audit_log), eskiden yeniye. */
    public function actions(Request $request): array
    {
        $id = (int) $request->args['id'];
        return ['actions' => Db::all(
            "SELECT (extract(epoch FROM time) * 1000)::bigint AS ts, action, target, detail, ip
             FROM audit_log WHERE login_session_id = ? ORDER BY id LIMIT 5000",
            [$id]
        )];
    }

    /**
     * Alt çubuk: şu an geçerli oturumu olan kullanıcı sayısı (her oturum sahibi görür) + 'logins' yetkisi
     * olana liste. Liste kullanıcı+IP başına TEK satır (aynı tarayıcıdan çıkış yapmadan tekrar tekrar girilince
     * ipucu yüzlerce satıra uzamasın): son giriş, oturum sayısı, son etkinlik; şu an etkin olanlar üstte.
     */
    public function active(Request $request, array $user): array
    {
        $rows = Db::all(
            "SELECT ls.username, max(u.full_name) AS full_name, ls.ip, count(*) AS sessions,
                    (extract(epoch FROM max(ls.started_at)) * 1000)::bigint AS started_ts,
                    (extract(epoch FROM max(ls.last_seen_at)) * 1000)::bigint AS last_seen_ts,
                    max(ls.last_seen_at) < now() - make_interval(mins => ?) AS idle,
                    bool_or(ls.id = ?) AS mine
             FROM sessions s
             JOIN login_sessions ls ON ls.session_hash = s.id
             LEFT JOIN users u ON u.id = ls.user_id
             WHERE s.expires_at > now()
             GROUP BY ls.username, ls.ip
             ORDER BY idle, max(ls.last_seen_at) DESC",
            [self::IDLE_MINUTES, $user['login_session_id'] ?? 0]
        );
        $users = count(array_unique(array_column($rows, 'username')));
        if (!Auth::can($user, 'logins')) {
            return ['users' => $users, 'sessions' => null];
        }
        return ['users' => $users, 'sessions' => $rows, 'total' => (int) array_sum(array_column($rows, 'sessions'))];
    }
}
