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

final class AuthApi
{
    private const MAX_FAILURES = 8;   // 10 dakikada, kullanıcı adı ya da adres başına

    /** frontend/source/class/ankamon/theme/Registry.js ile birebir eşleşmeli anahtarlar. */
    private const THEMES = [
        'blue-light', 'blue-dark', 'green-light', 'purple-dark',
        'qx-classic', 'qx-modern', 'qx-simple', 'qx-indigo', 'qx-indigo-dark',
        'qx-tangible-light', 'qx-tangible-dark',
        'fluent-light', 'fluent-dark', 'silverblue', 'graydient', 'darktheme', 'bernstein',
        'macos-light', 'macos-dark', 'gnome-light', 'gnome-dark', 'ubuntu',
    ];

    public function login(Request $request): array
    {
        $username = strtolower(trim((string) $request->input('username', '')));
        $password = (string) $request->input('password', '');

        $failures = (int) Db::value(
            "SELECT count(*) FROM audit_log
             WHERE action = 'login.failed' AND time > now() - interval '10 minutes' AND (target = ? OR ip = ?)",
            [$username, $request->ip()]
        );
        if ($failures >= self::MAX_FAILURES) {
            throw new ApiError(429, 'Çok fazla hatalı deneme. Birkaç dakika sonra yeniden deneyin.');
        }

        $user = Db::one('SELECT id, username, password_hash FROM users WHERE username = ? AND is_active', [$username]);
        if ($user === null || !password_verify($password, $user['password_hash'])) {
            Audit::log(null, $request, 'login.failed', $username);
            throw new ApiError(401, 'Kullanıcı adı ya da parola hatalı.');
        }

        Db::exec('UPDATE users SET last_login_at = now() WHERE id = ?', [$user['id']]);
        Auth::start((int) $user['id'], $request);
        Audit::log($user, $request, 'login');
        return ['ok' => true];
    }

    public function logout(Request $request): array
    {
        $user = Auth::user();
        if ($user !== null) {
            Audit::log($user, $request, 'logout');
        }
        Auth::end();
        return ['ok' => true];
    }

    public function me(Request $request, array $user): array
    {
        return [
            'id' => $user['id'],
            'username' => $user['username'],
            'full_name' => $user['full_name'],
            'is_admin' => $user['is_admin'],
            'theme' => in_array($user['theme'], self::THEMES, true) ? $user['theme'] : self::THEMES[0],
            'features' => $user['is_admin']
                ? array_keys(require dirname(__DIR__, 2) . '/config/features.php')
                : $user['features'],
            'nav_order' => $user['nav_order'],
            'screen_order' => $user['screen_order'],
            // Boşken JSON nesnesi ({}) dönsün, dizi ([]) değil: frontend anahtarla okur.
            'ui_prefs' => $user['ui_prefs'] ?: new \stdClass(),
        ];
    }

    /**
     * Tek bir arayüz tercihini yazar (bkz. users.ui_prefs, migration 010): {key, value}. value null
     * ise anahtar silinir. Anahtar kısa ve düz (harf/rakam/._-), değer en çok 16 KB JSON.
     */
    public function prefs(Request $request, array $user): array
    {
        $key = $request->input('key');
        if (!is_string($key) || !preg_match('/^[A-Za-z0-9._-]{1,80}$/', $key)) {
            throw ApiError::badRequest('Geçersiz tercih anahtarı.');
        }
        $value = $request->input('value');
        if ($value === null) {
            Db::exec('UPDATE users SET ui_prefs = ui_prefs - ?::text WHERE id = ?', [$key, $user['id']]);
            return ['ok' => true];
        }
        $json = json_encode($value, JSON_UNESCAPED_UNICODE);
        if ($json === false || strlen($json) > 16384) {
            throw ApiError::badRequest('Geçersiz tercih değeri.');
        }
        Db::exec(
            'UPDATE users SET ui_prefs = jsonb_set(ui_prefs, ARRAY[?]::text[], ?::jsonb, true) WHERE id = ?',
            [$key, $json, $user['id']]
        );
        return ['ok' => true];
    }

    /** Kullanıcının kendi tema tercihi; anında (sunucu tarafında) kalıcı, oturum başına değil. */
    public function theme(Request $request, array $user): array
    {
        $theme = (string) $request->input('theme', '');
        if (!in_array($theme, self::THEMES, true)) {
            throw ApiError::badRequest('Geçersiz tema.');
        }
        Db::exec('UPDATE users SET theme = ? WHERE id = ?', [$theme, $user['id']]);
        return ['ok' => true];
    }

    /**
     * Sol ağaçtaki ana düğümlerin sürükle-bırakla değiştirilen sırası (yalnız sayfa id'leri;
     * bkz. frontend ui/Shell.js PAGES/__createTree). Kullanıcı başına, oturum bağımsız kalıcıdır.
     */
    public function navOrder(Request $request, array $user): array
    {
        $order = $request->input('order');
        if (!is_array($order) || count($order) > 50) {
            throw ApiError::badRequest('Geçersiz sıra.');
        }
        foreach ($order as $id) {
            if (!is_string($id) || $id === '' || mb_strlen($id) > 40) {
                throw ApiError::badRequest('Geçersiz sıra.');
            }
        }
        Db::exec('UPDATE users SET nav_order = ?::jsonb WHERE id = ?', [json_encode(array_values($order)), $user['id']]);
        return ['ok' => true];
    }

    /**
     * "Ekranlar" sekmesindeki önizleme kutucuklarının sürükle-bırakla değiştirilen sırası (tahta
     * id'leri; bkz. frontend page/Boards.js __previewList + docker/rootfs/screen/index.html).
     * nav_order ile aynı mantık: kullanıcı başına, oturum bağımsız kalıcı.
     */
    public function screenOrder(Request $request, array $user): array
    {
        $order = $request->input('order');
        if (!is_array($order) || count($order) > 1000) {
            throw ApiError::badRequest('Geçersiz sıra.');
        }
        $ids = [];
        foreach ($order as $id) {
            if (!is_int($id) && !(is_string($id) && ctype_digit($id))) {
                throw ApiError::badRequest('Geçersiz sıra.');
            }
            $ids[] = (int) $id;
        }
        Db::exec('UPDATE users SET screen_order = ?::jsonb WHERE id = ?', [json_encode($ids), $user['id']]);
        return ['ok' => true];
    }

    public function password(Request $request, array $user): array
    {
        $current = (string) $request->input('current', '');
        $new = (string) $request->input('new', '');
        $hash = (string) Db::value('SELECT password_hash FROM users WHERE id = ?', [$user['id']]);
        if (!password_verify($current, $hash)) {
            throw ApiError::badRequest('Mevcut parola hatalı.');
        }
        if (mb_strlen($new) < 8) {
            throw ApiError::badRequest('Yeni parola en az 8 karakter olmalı.');
        }
        Db::exec('UPDATE users SET password_hash = ? WHERE id = ?', [password_hash($new, PASSWORD_DEFAULT), $user['id']]);
        // Diğer oturumlar düşsün; bu oturum kalsın.
        Db::exec('DELETE FROM sessions WHERE user_id = ? AND id <> ?', [$user['id'], $user['session_id']]);
        Audit::log($user, $request, 'password.change');
        return ['ok' => true];
    }

    /**
     * nginx auth_request ucu: /grafana/ isteklerinden önce çağrılır.
     * Oturum geçerliyse Grafana'ya iletilecek kullanıcı ve rol başlıklarını döner.
     */
    public function grafana(): array
    {
        $user = Auth::user();
        if ($user === null) {
            throw new ApiError(401, 'Oturum açmanız gerekiyor.');
        }
        if (!Auth::can($user, 'metrics')) {
            throw ApiError::forbidden();
        }
        header('X-Auth-User: ' . $user['username']);
        header('X-Auth-Role: ' . ($user['is_admin'] ? 'Admin' : 'Viewer'));
        return ['ok' => true];
    }

    /** nginx auth_request ucu: /webshell/ erişimi için oturum + "shell" yetkisi denetimi. */
    public function shell(): array
    {
        $user = Auth::user();
        if ($user === null) {
            throw new ApiError(401, 'Oturum açmanız gerekiyor.');
        }
        if (!Auth::can($user, 'shell')) {
            throw ApiError::forbidden();
        }
        return ['ok' => true];
    }

    /**
     * nginx auth_request ucu: /screen/ (canlı tahta ekranı) için oturum + "screen" yetkisi denetimi.
     * Kullanıcı adı ekran köprüsüne iletilir (kim hangi tahtayı izledi, etkinlik günlüğüne yazılır).
     */
    public function screen(): array
    {
        $user = Auth::user();
        if ($user === null) {
            throw new ApiError(401, 'Oturum açmanız gerekiyor.');
        }
        if (!Auth::can($user, 'screen')) {
            throw ApiError::forbidden();
        }
        header('X-Auth-User: ' . $user['username']);
        // Müdahale (fare/klavye) ayrı yetkidir; ekran köprüsü control=1 isteğini yalnız bu başlık 1 ise kabul eder.
        header('X-Auth-Control: ' . (Auth::can($user, 'screen.control') ? '1' : '0'));
        return ['ok' => true];
    }

    /**
     * nginx auth_request ucu: /screen/ws/taskmgr/ (Görev yöneticisi — canlı SSH + tahta ajanı) için oturum +
     * "taskmgr" yetkisi. Kullanıcı adı X-Auth-User ile ekran köprüsüne geçer (değişiklikler audit_log'a yazılır).
     */
    public function taskmgr(): array
    {
        $user = Auth::user();
        if ($user === null) {
            throw new ApiError(401, 'Oturum açmanız gerekiyor.');
        }
        if (!Auth::can($user, 'taskmgr')) {
            throw ApiError::forbidden();
        }
        header('X-Auth-User: ' . $user['username']);
        return ['ok' => true];
    }

    /**
     * nginx auth_request ucu: /cast/ (ekran yansıtma sayfası) ve /cast/mtx/ (WHIP → MediaMTX) için
     * oturum + "cast" yetkisi denetimi. Tahtalarda oynatıcıyı başlatmak ayrıca cast_start görevidir.
     */
    public function cast(): array
    {
        $user = Auth::user();
        if ($user === null) {
            throw new ApiError(401, 'Oturum açmanız gerekiyor.');
        }
        if (!Auth::can($user, 'cast')) {
            throw ApiError::forbidden();
        }
        return ['ok' => true];
    }

    /**
     * nginx auth_request ucu: /filemanager-open/, /filemanager-mount ve /filemanager/ için oturum +
     * "filemanager" yetkisi denetimi — tahtanın tüm dosya sistemine root erişim demektir.
     */
    public function filemanager(): array
    {
        $user = Auth::user();
        if ($user === null) {
            throw new ApiError(401, 'Oturum açmanız gerekiyor.');
        }
        if (!Auth::can($user, 'filemanager')) {
            throw ApiError::forbidden();
        }
        // FileBrowser 2.x'in yönetici hesap adları (varsayılan "admin" + services/filemanager.sh
        // auth.adminUsername): bu adla gelen proxy başlığı FileBrowser'da yönetici oturumu açar. Aynı adlı
        // bir Ankamon kullanıcısı dosya yöneticisine (FileBrowser hesabıyla) giremez.
        if (in_array(strtolower((string) $user['username']), ['admin', 'ankamon-fb-admin'], true)) {
            throw ApiError::forbidden('Bu kullanıcı adı dosya yöneticisinde ayrılmıştır; başka adlı bir kullanıcıyla girin.');
        }
        // Kim bağladı: köprü bunu başarılı bağlamada komut loguna yazar (bkz. worker/ankamon/filemanager).
        header('X-Auth-User: ' . $user['username']);
        return ['ok' => true];
    }
}
