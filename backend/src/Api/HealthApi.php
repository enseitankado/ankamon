<?php
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
