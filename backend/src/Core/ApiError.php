<?php
/*
 * SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

declare(strict_types=1);

namespace Ankamon\Core;

/** İstemciye olduğu gibi gösterilebilecek hata (HTTP durum koduyla). */
final class ApiError extends \RuntimeException
{
    public function __construct(public readonly int $status, string $message)
    {
        parent::__construct($message);
    }

    public static function badRequest(string $message): self
    {
        return new self(400, $message);
    }

    public static function notFound(string $message = 'Kayıt bulunamadı.'): self
    {
        return new self(404, $message);
    }

    public static function forbidden(string $message = 'Bu işlem için yetkiniz yok.'): self
    {
        return new self(403, $message);
    }
}
