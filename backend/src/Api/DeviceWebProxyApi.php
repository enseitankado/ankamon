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
use Ankamon\Core\Auth;
use Ankamon\Core\Db;
use Ankamon\Core\Request;

/**
 * Varlıklar ▸ "Web arayüzünü aç" (kullanıcı isteği 2026-11-10): arayüzü kullanan tarayıcı varlıkla AYNI ağdaysa (istemcinin
 * IP'si varlığın ağının CIDR'ında) varlığın adresi doğrudan yeni sekmede açılır; değilse (ör. idari ağdaki yönetici, tahta
 * ağındaki yazıcı) konteynerdeki nginx'in ayrı portundaki ters vekil üzerinden, arayüz içindeki pencerede gösterilir.
 *
 * Vekil (docker/rootfs/nginx-devproxy.conf, port DEVPROXY_PORT, vars. 8444): sayfanın KÖKÜNDEN yayın yapar — cihaz
 * arayüzlerinin mutlak yolları (/login.html, /cgi-bin/…) bozulmasın diye yol öneki kullanılmaz. Hedef, bu uçtan dönen
 * çerezdedir (ankamon_devproxy = "<şema>|<ip>|<port>|<imza>"); imza oturum anahtarıyla (ankamon_sid) HMAC — çerez başka
 * oturuma taşınamaz, sunucuya ayrı gizli anahtar gerekmez. nginx her istekte proxyAuth()'a sorar: oturum + "network" yetkisi
 * + imza + hedef IP'nin hâlâ envanterde olması (keyfi adrese vekil — SSRF — olmaz). Ankamon çerezleri cihaza iletilmez.
 */
final class DeviceWebProxyApi
{
    public const COOKIE = 'ankamon_devproxy';
    private const WEB_PORTS = [80, 443, 8080, 8443, 8000, 8008, 8081, 8888, 9443];

    /** POST /api/network/devices/{id}/web {port?, scheme?} → {direct, url} (direct değilse vekil çerezi yazılır). */
    public function open(Request $request, array $user): array
    {
        $id = $request->arg('id');
        $device = Db::one(
            "SELECT d.id, host(d.ip) AS ip, d.mac::text AS mac, n.cidr::text AS cidr,
                    (?::inet << n.cidr) AS same_net
             FROM net_devices d JOIN net_networks n ON n.id = d.network_id WHERE d.id = ?",
            [self::clientIp(), $id]
        ) ?? throw ApiError::notFound();
        if (empty($device['ip'])) {
            throw ApiError::badRequest('Bu varlığın bilinen bir IP adresi yok.');
        }
        $port = (int) $request->input('port', 80);
        $open = Db::value("SELECT 1 FROM net_services WHERE device_id = ? AND proto = 'tcp' AND port = ?", [$id, $port]) !== null;
        if ($port < 1 || $port > 65535 || (!$open && !in_array($port, self::WEB_PORTS, true))) {
            throw ApiError::badRequest('Bu port bir web arayüzü portu değil.');
        }
        $scheme = $request->input('scheme') === 'https' || in_array($port, [443, 8443, 9443], true) ? 'https' : 'http';
        $direct = (bool) $device['same_net'];
        Audit::log($user, $request, 'network.device.web', (string) $id, ['port' => $port, 'direct' => $direct]);
        if ($direct) {
            return ['direct' => true, 'url' => "$scheme://{$device['ip']}:$port/"];
        }
        $proxyPort = (int) (getenv('DEVPROXY_PORT') ?: 8444);
        if ($proxyPort === 0) {
            throw ApiError::badRequest('Web arayüzü vekili kapalı (DEVPROXY_PORT=0) ve bu tarayıcı varlıkla aynı ağda değil.');
        }
        $target = "$scheme|{$device['ip']}|$port";
        setcookie(self::COOKIE, $target . '|' . self::sign($target), [
            'path' => '/', 'httponly' => true, 'samesite' => 'Lax',
            'secure' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
        ]);
        return ['direct' => false, 'proxy_port' => $proxyPort, 'target' => "$scheme://{$device['ip']}:$port/"];
    }

    /** GET /api/auth/devproxy — yalnız nginx auth_request (bkz. nginx-devproxy.conf). 200 + X-Proxy-Target ya da 401/403. */
    public function proxyAuth(): array
    {
        $user = Auth::user() ?? throw new ApiError(401, 'Oturum açmanız gerekiyor.');
        if (!Auth::can($user, 'network')) {
            throw ApiError::forbidden();
        }
        $parts = explode('|', (string) ($_COOKIE[self::COOKIE] ?? ''));
        if (count($parts) !== 4) {
            throw ApiError::forbidden();
        }
        [$scheme, $ip, $port, $sig] = $parts;
        if (!hash_equals(self::sign("$scheme|$ip|$port"), $sig) || !in_array($scheme, ['http', 'https'], true)
            || filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) === false || !ctype_digit($port)) {
            throw ApiError::forbidden();
        }
        // Hedef hâlâ envanterde (silinmiş / IP'si değişmiş varlığa eski çerezle gidilmez).
        if (Db::value('SELECT 1 FROM net_devices WHERE ip = ?::inet', [$ip]) === null) {
            throw ApiError::forbidden();
        }
        header("X-Proxy-Target: $scheme://$ip:$port");
        return ['ok' => true];
    }

    private static function sign(string $target): string
    {
        return hash_hmac('sha256', $target, 'ankamon-devproxy|' . ($_COOKIE[Auth::COOKIE] ?? ''));
    }

    private static function clientIp(): string
    {
        $ip = (string) ($_SERVER['REMOTE_ADDR'] ?? '');
        return filter_var($ip, FILTER_VALIDATE_IP) !== false ? $ip : '0.0.0.0';
    }
}
