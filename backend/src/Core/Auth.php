<?php
declare(strict_types=1);

namespace Tihamon\Core;

/** Oturum (çerez + sessions tablosu) ve özellik yetkileri. */
final class Auth
{
    public const COOKIE = 'tihamon_sid';
    public const ADMIN_USERNAME = 'etapadmin';
    private const SESSION_HOURS = 12;

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
                    s.id AS session_id, s.expires_at < now() + interval \'6 hours\' AS renew
             FROM sessions s JOIN users u ON u.id = s.user_id
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
        $token = bin2hex(random_bytes(32));
        Db::exec(
            'INSERT INTO sessions (id, user_id, expires_at, ip, user_agent)
             VALUES (?, ?, now() + make_interval(hours => ?), ?, ?)',
            [hash('sha256', $token), $userId, self::SESSION_HOURS, $request->ip(),
             mb_substr($request->header('User-Agent'), 0, 250)]
        );
        Db::exec('DELETE FROM sessions WHERE expires_at < now()');
        self::setCookie($token);
    }

    public static function end(): void
    {
        $token = $_COOKIE[self::COOKIE] ?? '';
        if (is_string($token) && $token !== '') {
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
