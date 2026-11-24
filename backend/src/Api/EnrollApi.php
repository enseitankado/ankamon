<?php
/*
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Ankamon — ETAP akıllı tahtaları için merkezi log, izleme ve yönetim sunucusu
 * Copyright (C) 2026 Özgür Koca <ozgurkoca@gmail.com>
 * https://github.com/enseitankado/ankamon
 *
 * Bu program özgür yazılımdır: Free Software Foundation tarafından yayımlanan
 * GNU Affero Genel Kamu Lisansı'nın 3. sürümü ya da (tercihinize bağlı olarak)
 * daha sonraki herhangi bir sürümü koşulları altında yeniden dağıtabilir ve/veya
 * değiştirebilirsiniz.
 *
 * Bu program yararlı olması umuduyla dağıtılmaktadır, ancak HİÇBİR GARANTİSİ
 * YOKTUR; satılabilirlik veya belirli bir amaca uygunluk garantisi dahi
 * verilmez. Ayrıntılar için GNU Affero Genel Kamu Lisansı'na bakınız.
 *
 * Bu programla birlikte GNU Affero Genel Kamu Lisansı'nın bir kopyasını (LICENSE
 * dosyası) almış olmalısınız. Almadıysanız <https://www.gnu.org/licenses/>
 * adresine bakınız.
 *
 * Bu dosyadan (sınıf, işlev ya da işlev içi kod bloğu dahil) alınan her türlü
 * parça da AGPL-3.0-or-later ile lisanslıdır: parçayı kullanan türev eser aynı
 * lisansla yayımlanmalı, bu telif/atıf bildirimi ve değişiklik notu
 * korunmalıdır; değiştirilmiş sürüm ağ üzerinden hizmet olarak sunulursa
 * kullanıcılarına kaynak kodu sunulmalıdır (AGPLv3 madde 4, 5, 7(b) ve 13).
 */

declare(strict_types=1);

namespace Ankamon\Api;

use Ankamon\Core\ApiError;
use Ankamon\Core\Audit;
use Ankamon\Core\Db;
use Ankamon\Core\Request;
use Ankamon\Core\Settings;

/**
 * Yönetilemeyen cihazın Ankamon'a katılımı (kullanıcı isteği 2026-11-24). Ağda görünen ama Ankamon'un SSH ile
 * yönetemediği bir bilgisayarda kullanıcı TEK kısa komut yazar; komut Ankamon'dan bir betik çeker, betik:
 *   - yönetici değilse sudo ister (Windows'ta yönetici PowerShell'e yükselir),
 *   - OpenSSH sunucusunu kurar ve açılışta başlar yapar,
 *   - SSH kullanıcısının (Ayarlar ▸ Cihaz erişimi — genelde root) parolasını oradaki parola yapar ve parolayla girişe izin verir,
 *   - güvenlik duvarında 22/tcp'yi açar, sonunda kendini Ankamon'a bildirir (/k/<kod>/done — cihaz kaydı yoksa açılır).
 * Ankamon için gereken iki şey (OpenSSH + bilinen root parolası) bunlardır; gerisini (sensör, log …) Ankamon SSH ile kurar.
 *
 * Güvenlik: betikte parola vardır (Linux'ta yalnız SHA-512 crypt özeti — `usermod -p`; Windows'ta yerel hesap için düz
 * parola gerekir). Bu yüzden betik yalnız yöneticinin ürettiği SÜRELİ kodla verilir (en çok 24 saat; iptal edilebilir);
 * kod tahmin edilemez (6 karakter, 32 harfli alfabe ≈ 1 milyar). Kısa adres nginx'te /k/<kod> → /api/enroll/script
 * (düz HTTP'de kalır: cihazda sertifika güveni gerekmesin). Önşart: Cihaz erişimi parolası tanımlı olmalı (yoksa kod üretilmez).
 */
final class EnrollApi
{
    private const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
    private const CODE_LEN = 6;
    private const MAX_MINUTES = 1440;

    /** GET /api/enroll — önşart durumu + etkin kodlar (arayüz penceresi). */
    public function status(Request $request, array $user): array
    {
        $access = Settings::get('ssh_access');
        return [
            'password_set' => ($access['password'] ?? '') !== '',
            'ssh_user' => (string) ($access['user'] ?? 'root'),
            'base' => self::base(),
            'tokens' => array_map([self::class, 'tokenOut'], Db::all(
                "SELECT t.*, u.username AS created_by_name FROM device_enroll_tokens t LEFT JOIN users u ON u.id = t.created_by
                  WHERE NOT t.revoked AND t.expires_at > now() ORDER BY t.created_at DESC"
            )),
        ];
    }

    /** POST /api/enroll — yeni süreli kod {minutes}. */
    public function create(Request $request, array $user): array
    {
        $access = Settings::get('ssh_access');
        if (($access['password'] ?? '') === '') {
            throw ApiError::badRequest("Önce Sistem ▸ Ayarlar ▸ Cihaz erişimi'nde SSH (root) parolasını tanımlayın: katılım betiği cihazın root parolasını o parola yapar.");
        }
        $minutes = max(5, min(self::MAX_MINUTES, (int) ($request->input('minutes') ?? 60)));
        Db::exec("DELETE FROM device_enroll_tokens WHERE expires_at < now() - interval '30 days'");
        $code = '';
        for ($try = 0; $try < 10; $try++) {
            $code = '';
            for ($i = 0; $i < self::CODE_LEN; $i++) {
                $code .= self::ALPHABET[random_int(0, strlen(self::ALPHABET) - 1)];
            }
            if (!Db::value('SELECT 1 FROM device_enroll_tokens WHERE code = ?', [$code])) {
                break;
            }
        }
        Db::exec(
            "INSERT INTO device_enroll_tokens (code, created_by, expires_at) VALUES (?, ?, now() + make_interval(mins => ?))",
            [$code, $user['id'], $minutes]
        );
        Audit::log($user, $request, 'device.enroll.token', $code, ['minutes' => $minutes]);
        return self::tokenOut(Db::one(
            'SELECT t.*, ? AS created_by_name FROM device_enroll_tokens t WHERE code = ?', [$user['username'], $code]
        ));
    }

    /** POST /api/enroll/revoke {code} — kodu süresinden önce geçersiz kılar. */
    public function revoke(Request $request, array $user): array
    {
        $code = (string) $request->input('code');
        Db::exec('UPDATE device_enroll_tokens SET revoked = true WHERE code = ?', [$code]);
        Audit::log($user, $request, 'device.enroll.revoke', $code);
        return ['ok' => true];
    }

    /** GET /api/enroll/script?c=<kod>[&os=windows] (herkese açık — /k/<kod>): katılım betiği, düz metin. */
    public function script(Request $request, ?array $user): never
    {
        $windows = $request->query('os') === 'windows';
        header('Content-Type: text/plain; charset=utf-8');
        $code = strtolower((string) $request->query('c'));
        $token = self::valid($code);
        if ($token === null) {
            echo $windows
                ? "Write-Host 'Ankamon: katılım kodu geçersiz ya da süresi dolmuş. Ankamon arayüzünden yeni komut alın.' -ForegroundColor Red\n"
                : "echo 'Ankamon: katılım kodu geçersiz ya da süresi dolmuş. Ankamon arayüzünden yeni komut alın.' >&2; exit 1\n";
            exit;
        }
        Db::exec('UPDATE device_enroll_tokens SET fetches = fetches + 1, last_fetch_at = now(), last_fetch_ip = ? WHERE code = ?',
            [$request->ip(), $code]);
        Audit::log(null, $request, 'device.enroll.fetch', $code, ['os' => $windows ? 'windows' : 'linux']);
        $access = Settings::get('ssh_access');
        $url = self::base() . '/k/' . $code;
        $vars = [
            '__ANKAMON_URL__' => $url,
            '__ANKAMON_SSH_USER__' => (string) ($access['user'] ?: 'root'),
            '__ANKAMON_EXPIRES__' => (string) $token['expires_at'],
        ];
        if ($windows) {
            $vars['__ANKAMON_PASSWORD_B64__'] = base64_encode((string) $access['password']);
            $tpl = 'enroll-windows.ps1';
        } else {
            // Linux: düz parola değil, SHA-512 crypt özeti (usermod -p) — betik bir yere kopyalansa da parola görünmez.
            $vars['__ANKAMON_HASH__'] = crypt((string) $access['password'], '$6$' . bin2hex(random_bytes(8)) . '$');
            $tpl = 'enroll-linux.sh';
        }
        echo strtr((string) file_get_contents(dirname(__DIR__, 2) . '/config/enroll/' . $tpl), $vars);
        exit;
    }

    /**
     * POST /api/enroll/done?c=<kod> (herkese açık — betiğin sonu): cihaz kendini bildirir. Form alanları: hostname, os, family,
     * macs ("ad=mac=w|e" virgüllü; w kablosuz). Cihaz kaydı (kablolu ya da kablosuz MAC'iyle) yoksa açılır; Ankamon
     * SSH yoklamasıyla birkaç dakika içinde yönetilebilir görür. Yanıt düz metin (betik ekrana yazar).
     */
    public function done(Request $request, ?array $user): never
    {
        header('Content-Type: text/plain; charset=utf-8');
        $code = strtolower((string) $request->query('c'));
        if (self::valid($code) === null) {
            http_response_code(410);
            echo "Katılım kodu geçersiz ya da süresi dolmuş; cihaz bildirilemedi.\n";
            exit;
        }
        $hostname = substr((string) preg_replace('/[^A-Za-z0-9._-]/', '', (string) ($_POST['hostname'] ?? '')), 0, 63);
        $os = substr(trim((string) ($_POST['os'] ?? '')), 0, 120);
        $family = in_array($_POST['family'] ?? '', ['linux', 'windows', 'macos'], true) ? (string) $_POST['family'] : null;
        $wired = $wireless = [];
        foreach (explode(',', (string) ($_POST['macs'] ?? '')) as $item) {
            $parts = explode('=', trim($item));
            $mac = strtolower(str_replace('-', ':', $parts[1] ?? ''));
            if (!preg_match('/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/', $mac) || $mac === '00:00:00:00:00:00') {
                continue;
            }
            if (($parts[2] ?? 'e') === 'w') {
                $wireless[] = $mac;
            } else {
                $wired[] = $mac;
            }
        }
        $macs = array_values(array_unique(array_merge($wired, $wireless)));
        if (!$macs) {
            http_response_code(400);
            echo "Cihazın MAC adresi okunamadı; Ankamon'da cihazı elle ekleyin (Varlıklar ▸ Cihaz ekle).\n";
            exit;
        }
        $ip = $request->ip();
        $found = Db::one(
            "SELECT id, COALESCE(NULLIF(label, ''), hostname, host(ip)) AS name FROM devices
              WHERE mac::text = ANY(?::text[]) OR wifi_mac::text = ANY(?::text[]) LIMIT 1",
            ['{' . implode(',', $macs) . '}', '{' . implode(',', $macs) . '}']
        );
        $created = false;
        if ($found) {
            $id = (int) $found['id'];
            Db::exec('UPDATE devices SET ip = COALESCE(?::inet, ip) WHERE id = ?', [$ip !== '' ? $ip : null, $id]);
            $message = "Bu cihaz Ankamon'da zaten kayıtlı: {$found['name']}. SSH erişimi birkaç dakika içinde denetlenir.";
        } else {
            $mac = $wired[0] ?? $wireless[0];
            $wifi = $wired ? ($wireless[0] ?? null) : null;
            $label = $hostname !== '' ? $hostname : $ip;
            $id = (int) Db::value(
                "INSERT INTO devices (label, hostname, mac, wifi_mac, ip, source, os_family) VALUES (?, ?, ?, ?, ?::inet, 'enroll', ?) RETURNING id",
                [$label, $hostname !== '' ? $hostname : null, $mac, $wifi, $ip !== '' ? $ip : null, $family]
            );
            $created = true;
            $message = "Cihaz Ankamon'a eklendi: {$label}. SSH erişimi birkaç dakika içinde denetlenir ve cihaz yönetilebilir görünür.";
        }
        Db::exec(
            "UPDATE device_enroll_tokens SET joined = joined || jsonb_build_array(jsonb_build_object('at', extract(epoch FROM now())::bigint,
                    'ip', ?::text, 'hostname', ?::text, 'mac', ?::text, 'os', ?::text, 'device_id', ?::int, 'created', ?::boolean))
              WHERE code = ?",
            [$ip, $hostname, $macs[0], $os, $id, $created, $code]
        );
        Audit::log(null, $request, 'device.enroll.join', $hostname . ' ' . $macs[0], ['code' => $code, 'device_id' => $id, 'created' => $created, 'os' => $os]);
        echo $message . "\n";
        exit;
    }

    /** @return array<string,mixed>|null geçerli (süresi dolmamış, iptal edilmemiş) kod satırı */
    private static function valid(string $code): ?array
    {
        if (!preg_match('/^[a-z0-9]{6}$/', $code)) {
            return null;
        }
        return Db::one(
            "SELECT code, expires_at FROM device_enroll_tokens WHERE code = ? AND NOT revoked AND expires_at > now()", [$code]
        );
    }

    /** Cihazın betiği çekeceği adres: tarayıcının Ankamon'a eriştiği ad/IP + düz HTTP portu (/k/ HTTPS'e yönlenmez). */
    private static function base(): string
    {
        $host = (string) ($_SERVER['HTTP_HOST'] ?? $_SERVER['SERVER_NAME'] ?? '');
        $host = preg_replace('/:\d+$/', '', $host) ?? $host;
        if (str_starts_with($host, '[')) {
            $host = rtrim($host, ']') . ']';
        }
        $port = (int) (getenv('HTTP_PORT') ?: 80);
        return 'http://' . $host . ($port !== 80 ? ':' . $port : '');
    }

    private static function tokenOut(array $t): array
    {
        $url = self::base() . '/k/' . $t['code'];
        $short = preg_replace('#^http://#', '', $url);
        return [
            'code' => $t['code'],
            'created_at' => strtotime((string) $t['created_at']),
            'expires_at' => strtotime((string) $t['expires_at']),
            'created_by' => $t['created_by_name'] ?? null,
            'fetches' => (int) $t['fetches'],
            'joined' => json_decode((string) $t['joined'], true) ?: [],
            'commands' => [
                'linux' => "curl -sL {$short} | sh",
                'linux_wget' => "wget -qO- {$short} | sh",
                'windows' => "irm {$url}.ps1 | iex",
            ],
        ];
    }
}
