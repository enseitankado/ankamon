<?php
declare(strict_types=1);

namespace Tihamon\Core;

/** Kim, ne zaman, ne yaptı: yönetim işlemlerinin kaydı. */
final class Audit
{
    /** @param array<string,mixed>|null $user */
    public static function log(?array $user, Request $request, string $action, string $target = '', array $detail = []): void
    {
        Db::exec(
            'INSERT INTO audit_log (user_id, username, action, target, detail, ip) VALUES (?, ?, ?, ?, ?::jsonb, ?)',
            [$user['id'] ?? null, $user['username'] ?? null, $action, $target,
             json_encode($detail, JSON_UNESCAPED_UNICODE), $request->ip()]
        );
    }
}
