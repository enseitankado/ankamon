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
    /**
     * Bağlantı ölçütü: açık bir Tiha-Mon sekmesi alt çubuktan sürekli istek atar (saniyede bir; arka plandaki
     * sekmeyi tarayıcı en çok dakikada bire kısar) ve Auth::user last_seen_at'i dakikada bir yazar. Son istek
     * bundan eskiyse tarayıcı kapanmış/sekme kapatılmış sayılır ("bağlantı kesildi") — belirteç hâlâ geçerli
     * olsa da (çıkış yapmadan kapatılan tarayıcı) oturum "açık" gösterilmez (göç 021).
     */
    private const PRESENCE_MINUTES = 3;
    /** "Aktif" (sekme görünür + pencere odakta) bildirimi bundan eskiyse sayılmaz (tarayıcı 15 sn'de bir yeniler). */
    private const FOCUS_STALE_SECONDS = 40;

    /** Belirteç geçerli + son istek taze: tarayıcıda açık. */
    private const PRESENT = "(s.id IS NOT NULL AND s.expires_at > now()
                              AND coalesce(ls.last_seen_at, ls.started_at) > now() - make_interval(mins => %d))";

    /**
     * Oturum durumu: active (açık, sekme odakta) / open (açık, arka planda) / gone (çıkış yapılmadan tarayıcı
     * kapandı) / logout / replaced (yeniden giriş) / revoked / expired.
     */
    private static function status(): string
    {
        $present = sprintf(self::PRESENT, self::PRESENCE_MINUTES);
        return "CASE WHEN ls.ended_at IS NOT NULL THEN ls.end_reason
                     WHEN ls.expires_at IS NOT NULL AND ls.expires_at <= now() THEN 'expired'
                     WHEN s.id IS NULL THEN 'revoked'
                     WHEN NOT $present THEN 'gone'
                     WHEN ls.focused AND ls.focus_at > now() - make_interval(secs => " . self::FOCUS_STALE_SECONDS . ") THEN 'active'
                     ELSE 'open' END";
    }

    /**
     * Oturumun GERÇEK bitişi (süre bundan hesaplanır): çıkış/yeniden giriş anı; kendiliğinden biten (süre
     * dolma, sonlandırma, bağlantı kesilmesi) oturumda son istek anı — belirtecin geçerlilik süresi değil.
     * Hâlâ açıksa NULL (sürüyor).
     */
    private static function endExpr(): string
    {
        $present = sprintf(self::PRESENT, self::PRESENCE_MINUTES);
        return "CASE WHEN ls.end_reason IN ('logout', 'replaced') THEN ls.ended_at
                     WHEN ls.ended_at IS NULL AND $present THEN NULL
                     ELSE least(coalesce(ls.ended_at, now()), coalesce(ls.last_seen_at, ls.started_at)) END";
    }

    public function index(Request $request): array
    {
        $days = $request->queryInt('days', 30, 1, 365);
        $limit = $request->queryInt('limit', 2000, 1, 10000);
        $status = self::status();
        $end = self::endExpr();
        $rows = Db::all(
            "SELECT ls.id, ls.username, u.full_name, ls.ip, ls.user_agent,
                    (extract(epoch FROM ls.started_at) * 1000)::bigint AS started_ts,
                    (extract(epoch FROM ls.last_seen_at) * 1000)::bigint AS last_seen_ts,
                    (extract(epoch FROM $end) * 1000)::bigint AS ended_ts,
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
        return ['sessions' => $rows, 'presence_minutes' => self::PRESENCE_MINUTES];
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
     * Alt çubuk: şu an BAĞLI (belirteci geçerli VE son isteği PRESENCE_MINUTES'tan taze — çıkış yapmadan
     * kapatılan tarayıcılar sayılmaz, göç 021) kullanıcı sayısı (her oturum sahibi görür) + 'logins' yetkisi
     * olana liste. Liste kullanıcı+IP başına TEK satır (aynı tarayıcıdan çıkış yapmadan tekrar tekrar girilince
     * ipucu yüzlerce satıra uzamasın): son giriş, oturum sayısı, son etkinlik; şu an etkin olanlar üstte.
     *
     * `?focused=0|1` (alt çubuk gönderir; göç 020): çağıran oturumun Tiha-Mon sekmesi görünür VE tarayıcı
     * penceresi odakta mı. `active` = gruptaki bir oturum odakta ve bildirimi FOCUS_STALE_SECONDS'tan taze
     * (sekme kapanınca/ağ gidince bildirim kesilir, kendiliğinden düşer) → ipucunda yeşil "Aktif".
     */
    public function active(Request $request, array $user): array
    {
        $focused = $request->query('focused');
        if ($focused !== null && $focused !== '' && !empty($user['login_session_id'])) {
            Db::exec('UPDATE login_sessions SET focused = ?, focus_at = now() WHERE id = ?',
                [$focused === '1' ? 't' : 'f', $user['login_session_id']]);
        }
        $rows = Db::all(
            "SELECT ls.username, max(u.full_name) AS full_name, ls.ip, count(*) AS sessions,
                    (extract(epoch FROM max(ls.started_at)) * 1000)::bigint AS started_ts,
                    (extract(epoch FROM max(ls.last_seen_at)) * 1000)::bigint AS last_seen_ts,
                    bool_or(ls.focused AND ls.focus_at > now() - make_interval(secs => ?)) AS active,
                    bool_or(ls.id = ?) AS mine
             FROM sessions s
             JOIN login_sessions ls ON ls.session_hash = s.id
             LEFT JOIN users u ON u.id = ls.user_id
             WHERE " . sprintf(self::PRESENT, self::PRESENCE_MINUTES) . "
             GROUP BY ls.username, ls.ip
             ORDER BY active DESC, max(ls.last_seen_at) DESC",
            [self::FOCUS_STALE_SECONDS, $user['login_session_id'] ?? 0]
        );
        $users = count(array_unique(array_column($rows, 'username')));
        if (!Auth::can($user, 'logins')) {
            return ['users' => $users, 'sessions' => null];
        }
        return ['users' => $users, 'sessions' => $rows, 'total' => (int) array_sum(array_column($rows, 'sessions'))];
    }
}
