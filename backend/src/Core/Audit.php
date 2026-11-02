<?php
/*
 * SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

declare(strict_types=1);

namespace Ankamon\Core;

/** Kim, ne zaman, ne yaptı: yönetim işlemlerinin kaydı. */
final class Audit
{
    /** @var null|callable(array<string,mixed>|null, Request, string): bool İsteğe bağlı kayıt ilkesi. */
    private static $policy = null;

    /**
     * İsteğe bağlı kayıt ilkesi: (user, request, action) => bool. İlke false döndürürse o işlem audit_log'a
     * YAZILMAZ. Eklentiler kendi backend/boot.php'sinden tanımlar; çekirdek ilkenin ne yaptığını bilmez
     * (opak geri çağrı). null (varsayılan) = her işlem yazılır. Tek yuvalıdır: sonraki çağrı öncekini değiştirir.
     *
     * @param null|callable(array<string,mixed>|null, Request, string): bool $policy
     */
    public static function setPolicy(?callable $policy): void
    {
        self::$policy = $policy;
    }

    /** @param array<string,mixed>|null $user */
    public static function log(?array $user, Request $request, string $action, string $target = '', array $detail = []): void
    {
        if (self::$policy !== null && (self::$policy)($user, $request, $action) === false) {
            return;
        }
        // Oturum geçmişi (Kullanıcılar ▸ Oturumlar): kayıt, işlemin yapıldığı oturuma bağlanır; girişte
        // oturum bu istekte açıldığından Auth::startedLoginSession'dan gelir.
        $loginSession = $user['login_session_id'] ?? Auth::startedLoginSession();
        Db::exec(
            'INSERT INTO audit_log (user_id, username, action, target, detail, ip, login_session_id) VALUES (?, ?, ?, ?, ?::jsonb, ?, ?)',
            [$user['id'] ?? null, $user['username'] ?? null, $action, $target,
             json_encode($detail, JSON_UNESCAPED_UNICODE), $request->ip(), $loginSession]
        );
    }
}
