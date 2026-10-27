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
    /** @param array<string,mixed>|null $user */
    public static function log(?array $user, Request $request, string $action, string $target = '', array $detail = []): void
    {
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
