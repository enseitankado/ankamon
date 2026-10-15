<?php
declare(strict_types=1);

namespace Tihamon\Api;

use Tihamon\Core\ApiError;
use Tihamon\Core\Audit;
use Tihamon\Core\Auth;
use Tihamon\Core\Db;
use Tihamon\Core\Request;

/** Kullanıcı yönetimi — yalnız yönetici (etapadmin). */
final class UsersApi
{
    private const COLUMNS = 'id, username, full_name, is_admin, is_active, to_json(features) AS features,
                             extract(epoch FROM last_login_at)::bigint AS last_login_at';

    public function features(): array
    {
        $items = [];
        $deps = self::featureDeps();
        foreach (self::featureCatalog() as $key => $label) {
            $items[] = ['key' => $key, 'label' => $label, 'parent' => $deps[$key] ?? null];
        }
        return ['features' => $items];
    }

    public function index(): array
    {
        $users = Db::all('SELECT ' . self::COLUMNS . ' FROM users ORDER BY username');
        return ['users' => array_map(self::decode(...), $users)];
    }

    public function create(Request $request, array $admin): array
    {
        $username = strtolower(trim((string) $request->input('username', '')));
        if (!preg_match('/^[a-z0-9][a-z0-9._-]{2,31}$/', $username)) {
            throw ApiError::badRequest('Kullanıcı adı 3-32 karakter olmalı; küçük harf, rakam, nokta, tire içerebilir.');
        }
        if (Db::value('SELECT 1 FROM users WHERE username = ?', [$username])) {
            throw ApiError::badRequest('Bu kullanıcı adı zaten var.');
        }
        $password = (string) $request->input('password', '');
        if (mb_strlen($password) < 8) {
            throw ApiError::badRequest('Parola en az 8 karakter olmalı.');
        }
        $id = Db::value(
            'INSERT INTO users (username, full_name, password_hash, features, is_active) VALUES (?, ?, ?, ?::text[], ?) RETURNING id',
            [$username, trim((string) $request->input('full_name', '')), password_hash($password, PASSWORD_DEFAULT),
             Db::textArray(self::cleanFeatures($request->input('features', []))),
             (bool) $request->input('is_active', true)]
        );
        Audit::log($admin, $request, 'user.create', $username);
        return ['id' => $id];
    }

    public function update(Request $request, array $admin): array
    {
        $target = Db::one('SELECT id, username FROM users WHERE id = ?', [$request->arg('id')])
            ?? throw ApiError::notFound();
        $isRoot = $target['username'] === Auth::ADMIN_USERNAME;

        if ($request->has('full_name')) {
            Db::exec('UPDATE users SET full_name = ? WHERE id = ?', [trim((string) $request->input('full_name')), $target['id']]);
        }
        if ($request->has('features') && !$isRoot) {
            Db::exec('UPDATE users SET features = ?::text[] WHERE id = ?',
                [Db::textArray(self::cleanFeatures($request->input('features'))), $target['id']]);
        }
        if ($request->has('is_active') && !$isRoot) {
            $active = (bool) $request->input('is_active');
            Db::exec('UPDATE users SET is_active = ? WHERE id = ?', [$active, $target['id']]);
            if (!$active) {
                Db::exec('DELETE FROM sessions WHERE user_id = ?', [$target['id']]);
            }
        }
        if ($request->input('password')) {
            $password = (string) $request->input('password');
            if (mb_strlen($password) < 8) {
                throw ApiError::badRequest('Parola en az 8 karakter olmalı.');
            }
            Db::exec('UPDATE users SET password_hash = ? WHERE id = ?', [password_hash($password, PASSWORD_DEFAULT), $target['id']]);
            Db::exec('DELETE FROM sessions WHERE user_id = ? AND id <> ?', [$target['id'], $admin['session_id']]);
        }
        Audit::log($admin, $request, 'user.update', $target['username'], ['fields' => array_keys(array_diff_key($request->body(), ['password' => 1]))]);
        return ['ok' => true];
    }

    public function delete(Request $request, array $admin): array
    {
        $target = Db::one('SELECT id, username FROM users WHERE id = ?', [$request->arg('id')])
            ?? throw ApiError::notFound();
        if ($target['username'] === Auth::ADMIN_USERNAME) {
            throw ApiError::badRequest('etapadmin hesabı silinemez.');
        }
        Db::exec('DELETE FROM users WHERE id = ?', [$target['id']]);
        Audit::log($admin, $request, 'user.delete', $target['username']);
        return ['ok' => true];
    }

    /** @return array<string,string> */
    private static function featureCatalog(): array
    {
        return require dirname(__DIR__, 2) . '/config/features.php';
    }

    /** @return array<string,string> alt özellik => üst özellik (bkz. config/feature_deps.php) */
    private static function featureDeps(): array
    {
        return require dirname(__DIR__, 2) . '/config/feature_deps.php';
    }

    /**
     * Yalnız katalogda tanımlı anahtarları bırakır; alt özelliklerin üstünü kendiliğinden ekler
     * (ör. "screen.control" → "screen" → "boards"): üstü olmadan alt özellik arayüzde kullanılamaz.
     */
    private static function cleanFeatures(mixed $features): array
    {
        $wanted = is_array($features) ? array_map('strval', $features) : [];
        $deps = self::featureDeps();
        for ($i = 0; $i < count($wanted); $i++) {
            $parent = $deps[$wanted[$i]] ?? null;
            if ($parent !== null && !in_array($parent, $wanted, true)) {
                $wanted[] = $parent;
            }
        }
        return array_values(array_intersect(array_keys(self::featureCatalog()), $wanted));
    }

    private static function decode(array $user): array
    {
        $user['features'] = json_decode((string) $user['features'], true) ?: [];
        return $user;
    }
}
