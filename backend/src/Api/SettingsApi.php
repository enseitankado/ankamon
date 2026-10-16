<?php
declare(strict_types=1);

namespace Tihamon\Api;

use Tihamon\Core\ApiError;
use Tihamon\Core\Audit;
use Tihamon\Core\Request;
use Tihamon\Core\Settings;

/** Sistem ayarları — yalnız yönetici. Tahta parolaları hiçbir zaman geri gönderilmez. */
final class SettingsApi
{
    public function show(): array
    {
        return [
            'ssh_access' => self::redacted(Settings::get('ssh_access')),
            'samba_access' => self::redacted(Settings::get('samba_access')),
            'screen_vnc_autoinstall' => (bool) Settings::get('screen_vnc_autoinstall'),
            'syslog_port' => (int) (getenv('SYSLOG_PORT') ?: 514),
            'scrape_interval' => getenv('SCRAPE_INTERVAL') ?: '60s',
        ];
    }

    public function update(Request $request, array $user): array
    {
        $changed = [];
        foreach (['ssh_access', 'samba_access'] as $key) {
            if (is_array($input = $request->input($key))) {
                self::saveAccess($key, $input);
                $changed[] = $key;
            }
        }
        if ($request->input('screen_vnc_autoinstall') !== null) {
            Settings::set('screen_vnc_autoinstall', (bool) $request->input('screen_vnc_autoinstall'));
            $changed[] = 'screen_vnc_autoinstall';
        }
        Audit::log($user, $request, 'settings.update', implode(',', $changed));
        return ['ok' => true];
    }

    private static function saveAccess(string $key, array $input): void
    {
        $access = Settings::get($key);
        $name = trim((string) ($input['user'] ?? $access['user']));
        if (!preg_match('/^[a-z_][a-z0-9_.-]{0,31}$/', $name)) {
            throw ApiError::badRequest('Geçersiz kullanıcı adı.');
        }
        $access['user'] = $name;
        // Boş parola "değiştirme" demektir.
        if (($input['password'] ?? '') !== '') {
            $access['password'] = (string) $input['password'];
        }
        Settings::set($key, $access);
    }

    private static function redacted(array $access): array
    {
        return ['user' => $access['user'], 'password_set' => $access['password'] !== ''];
    }
}
