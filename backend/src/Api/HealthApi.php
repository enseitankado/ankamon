<?php
/*
 * SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

declare(strict_types=1);

namespace Ankamon\Api;

use Ankamon\Core\Db;

final class HealthApi
{
    public function health(): array
    {
        Db::value('SELECT 1');
        return ['ok' => true];
    }
}
