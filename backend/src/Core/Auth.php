<?php
declare(strict_types=1);

namespace Tihamon\Core;

/** Oturum (çerez + sessions tablosu) ve özellik yetkileri. */
final class Auth
{
    public const COOKIE = 'tihamon_sid';
    public const ADMIN_USERNAME = 'etapadmin';
    private const SESSION_HOURS = 12;
    /** Oturum geçmişi (login_sessions, göç 019) bu kadar gün tutulur. */
    private const HISTORY_DAYS = 365;

    /** Bu istekte başlatılan oturumun login_sessions kimliği (giriş kaydı için; bkz. Audit::log). */
    private static ?int $startedLoginSession = null;

    /** @return array<string,mixed>|null */
    public static function user(): ?array
    {
        $token = $_COOKIE[self::COOKIE] ?? '';
        if (!is_string($token) || $token === '') {
            return null;
        }
        $row = Db::one(
            'SELECT u.id, u.username, u.full_name, u.is_admin, u.theme, to_json(u.features) AS features,
                    u.nav_order, u.screen_order, u.ui_prefs,
                    s.id AS session_id, s.expires_at < now() + interval \'6 hours\' AS renew,
                    ls.id AS login_session_id,
                    (ls.last_seen_at IS NULL OR ls.last_seen_at < now() - interval \'1 minute\') AS seen_stale
             FROM sessions s JOIN users u ON u.id = s.user_id
             LEFT JOIN login_sessions ls ON ls.session_hash = s.id
             WHERE s.id = ? AND s.expires_at > now() AND u.is_active',
            [hash('sha256', $token)]
        );
        if ($row === null) {
            return null;
        }
        if ($row['renew']) {
            // Kullanıldıkça uzayan oturum.
            Db::exec('UPDATE sessions SET expires_at = now() + make_interval(hours => ?) WHERE id = ?',
                [self::SESSION_HOURS, $row['session_id']]);
            self::setCookie($token);
        }
        if ($row['login_session_id'] !== null && $row['seen_stale']) {
            // "Son etkinlik" (Kullanıcılar ▸ Oturumlar): dakikada en çok bir yazma.
            Db::exec('UPDATE login_sessions SET last_seen_at = now() WHERE id = ?', [$row['login_session_id']]);
        }
        $row['login_session_id'] = $row['login_session_id'] === null ? null : (int) $row['login_session_id'];
        unset($row['seen_stale']);
        $row['features'] = json_decode((string) $row['features'], true) ?: [];
        $row['nav_order'] = json_decode((string) $row['nav_order'], true) ?: [];
        $row['screen_order'] = json_decode((string) $row['screen_order'], true) ?: [];
        $row['ui_prefs'] = json_decode((string) $row['ui_prefs'], true) ?: [];
        unset($row['renew']);
        return $row;
    }

    /** @param array<string,mixed> $user */
    public static function can(array $user, string $feature): bool
    {
        return $user['is_admin'] || in_array($feature, $user['features'], true);
    }

    public static function start(int $userId, Request $request): void
    {
        // Aynı tarayıcı çıkış yapmadan yeniden giriş yapıyorsa eski belirteç burada biter ('replaced', göç
        // 021): çerez yenisiyle değişeceğinden eskisi bir daha kullanılamaz — yoksa 12 sa "açık" kalıp oturum
        // geçmişinde aynı kişinin art arda açık kayıtları birikiyordu (kullanıcı bildirdi).
        $old = $_COOKIE[self::COOKIE] ?? '';
        if (is_string($old) && $old !== '') {
            Db::exec("UPDATE login_sessions SET end_reason = 'replaced', ended_at = now() WHERE session_hash = ? AND ended_at IS NULL",
                [hash('sha256', $old)]);
            Db::exec('DELETE FROM sessions WHERE id = ?', [hash('sha256', $old)]);
        }
        $token = bin2hex(random_bytes(32));
        Db::exec(
            'INSERT INTO sessions (id, user_id, expires_at, ip, user_agent)
             VALUES (?, ?, now() + make_interval(hours => ?), ?, ?)',
            [hash('sha256', $token), $userId, self::SESSION_HOURS, $request->ip(),
             mb_substr($request->header('User-Agent'), 0, 250)]
        );
        Db::exec('DELETE FROM sessions WHERE expires_at < now()');
        $id = Db::value('SELECT id FROM login_sessions WHERE session_hash = ?', [hash('sha256', $token)]);
        self::$startedLoginSession = $id === null ? null : (int) $id;
        Db::exec('DELETE FROM login_sessions WHERE started_at < now() - make_interval(days => ?) AND ended_at IS NOT NULL',
            [self::HISTORY_DAYS]);
        self::setCookie($token);
    }

    /** Bu istekte Auth::start ile açılan oturumun login_sessions kimliği (yoksa null). */
    public static function startedLoginSession(): ?int
    {
        return self::$startedLoginSession;
    }

    public static function end(): void
    {
        $token = $_COOKIE[self::COOKIE] ?? '';
        if (is_string($token) && $token !== '') {
            // Önce neden yazılır: silme tetikleyicisi (göç 019) boş nedeni "revoked/expired" sayar.
            Db::exec("UPDATE login_sessions SET end_reason = 'logout', ended_at = now() WHERE session_hash = ? AND ended_at IS NULL",
                [hash('sha256', $token)]);
            Db::exec('DELETE FROM sessions WHERE id = ?', [hash('sha256', $token)]);
        }
        setcookie(self::COOKIE, '', ['expires' => 1, 'path' => '/', 'httponly' => true, 'samesite' => 'Lax']);
    }

    private static function setCookie(string $token): void
    {
        setcookie(self::COOKIE, $token, [
            'expires' => time() + self::SESSION_HOURS * 3600,
            'path' => '/',
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
    }
}
