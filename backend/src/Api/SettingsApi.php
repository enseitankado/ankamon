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
            'network_roles' => Settings::get('network_roles'),
            'interfaces' => self::interfaces(),
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
        if (is_array($roles = $request->input('network_roles'))) {
            Settings::set('network_roles', self::roles($roles));
            $changed[] = 'network_roles';
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

    /**
     * Sunucunun fiziksel ağ arabirimleri (konteyner host ağında: gerçek kartlar). Docker köprüleri,
     * sanal eşler ve döngü atlanır. [{name, up, addresses: ["192.168.1.5/24", …]}]
     */
    private static function interfaces(): array
    {
        $list = [];
        foreach (net_get_interfaces() ?: [] as $name => $info) {
            if ($name === 'lo' || preg_match('/^(docker|br-|veth|virbr|tun|tap|wg)/', (string) $name)) {
                continue;
            }
            $addresses = [];
            foreach ($info['unicast'] ?? [] as $u) {
                if (($u['family'] ?? 0) === 2 /* AF_INET; sockets eklentisi yok */ && isset($u['address'], $u['netmask'])) {
                    $bits = substr_count(decbin(ip2long($u['netmask']) ?: 0), '1');
                    $addresses[] = $u['address'] . '/' . $bits;
                }
            }
            $list[] = ['name' => (string) $name, 'up' => (bool) ($info['up'] ?? false), 'addresses' => $addresses];
        }
        usort($list, fn ($a, $b) => strnatcmp($a['name'], $b['name']));
        return $list;
    }

    /** Ağ rolleri girdisi: arabirim adı ya da boş (otomatik). İki rol aynı arabirim olamaz. */
    private static function roles(array $input): array
    {
        $roles = [];
        foreach (['board_iface', 'admin_iface'] as $key) {
            $name = trim((string) ($input[$key] ?? ''));
            if ($name !== '' && !preg_match('/^[A-Za-z0-9_.:-]{1,15}$/', $name)) {
                throw ApiError::badRequest('Geçersiz arabirim adı.');
            }
            $roles[$key] = $name;
        }
        if ($roles['board_iface'] !== '' && $roles['board_iface'] === $roles['admin_iface']) {
            throw ApiError::badRequest('Tahta ağı ve idari ağ için farklı arabirimler seçin.');
        }
        return $roles;
    }

    private static function redacted(array $access): array
    {
        return ['user' => $access['user'], 'password_set' => $access['password'] !== ''];
    }
}
