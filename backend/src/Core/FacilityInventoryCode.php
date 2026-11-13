<?php
/*
 * SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

declare(strict_types=1);

namespace Ankamon\Core;

/**
 * Tesis Envanteri Kodlama Sistemi (Hiyerarşik Fiziksel Lokasyon Kodlama ve Adresleme Sistemi): bir yerin adresi
 * il.ilçe.tesis.bina.kat.salon biçiminde, noktayla ayrılmış sayılardır (ör. 55.11.165.1.2.15 = 55 il, 11 ilçe, 165 tesis,
 * 1. bina, 2. kat, 15. salon). İlk üç parça kurumun kendisidir ve Ayarlar ▸ Kuruluş'ta bir kez girilir (asıl kaynak);
 * cihazların Fiziksel konum alanında ve Envanter eklentisinin envanter numarasında önek olarak kullanılır.
 */
final class FacilityInventoryCode
{
    /** organization ayarındaki anahtar => [etiket, en çok basamak]. */
    public const PARTS = [
        'il_kodu' => ['İl kodu', 2],
        'ilce_kodu' => ['İlçe kodu', 2],
        'tesis_kodu' => ['Tesis kodu', 4],
    ];

    /**
     * Fiziksel konum değerini kaydetmeden önce tamamlar: yalnız bina.kat.salon (üç sayı) yazıldıysa ve Kuruluş'ta il/ilçe/tesis
     * kodları girilmişse başına önek eklenir ("1.2.15" → "55.11.165.1.2.15"). Serbest metin olduğu gibi kalır.
     */
    public static function complete(string $value): string
    {
        $value = trim($value);
        if (preg_match('/^[0-9]+\.[0-9]+\.[0-9]+$/', $value) && ($prefix = self::prefix()) !== '') {
            return $prefix . $value;
        }
        return $value;
    }

    /** Kuruluş'taki il.ilçe.tesis kodlarından önek ("55.11.165."); üçü de girilmemişse boş metin. */
    public static function prefix(): string
    {
        $org = Settings::get('organization');
        $parts = [];
        foreach (array_keys(self::PARTS) as $key) {
            $part = trim((string) ($org[$key] ?? ''));
            if ($part === '') {
                return '';
            }
            $parts[] = $part;
        }
        return implode('.', $parts) . '.';
    }
}
