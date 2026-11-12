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

namespace Ankamon\Core;

/**
 * Yedekleme planı (Sistem ▸ Yedekler): settings.backup_policy. Verilmeyen alan kurulum varsayılanıdır — ortam
 * değişkenleri BACKUP_CONFIG_EVERY_HOURS, BACKUP_FULL_AT, BACKUP_KEEP_CONFIG, BACKUP_KEEP_FULL, HOME_BACKUP_KEEP_HOURS
 * (.env). Planı yedekleme servisi uygular: docker/backup/backup.sh her turda docker/backup/policy.py ile okur — AYNI
 * varsayılan ve sınırlar orada da; biri değişirse öteki de.
 */
final class BackupPolicy
{
    /** Tür → [alan → [en az, en çok]] (saat "HH:MM" ayrıca doğrulanır). */
    public const LIMITS = [
        'config' => ['every_hours' => [1, 168], 'keep' => [1, 1000]],
        'full' => ['keep' => [1, 365]],
        'files' => ['keep' => [1, 365]],
        'home' => ['keep_hours' => [1, 2160]],
    ];

    public static function defaults(): array
    {
        $int = static fn(string $name, int $default) => is_numeric(getenv($name)) ? (int) getenv($name) : $default;
        $at = getenv('BACKUP_FULL_AT');
        return [
            'config' => ['enabled' => true, 'every_hours' => $int('BACKUP_CONFIG_EVERY_HOURS', 6), 'keep' => $int('BACKUP_KEEP_CONFIG', 28)],
            'full' => ['enabled' => true, 'at' => is_string($at) && self::isClock($at) ? $at : '03:30', 'keep' => $int('BACKUP_KEEP_FULL', 7)],
            'files' => ['enabled' => true, 'at' => '04:00', 'keep' => 7],
            'home' => ['keep_hours' => $int('HOME_BACKUP_KEEP_HOURS', 72)],
        ];
    }

    /** Geçerli plan: kayıtlı değerler varsayılanların üstüne (geçersiz alan varsayılana düşer). */
    public static function get(): array
    {
        $saved = Settings::get('backup_policy');
        $policy = self::defaults();
        foreach ($policy as $kind => $fields) {
            foreach ($fields as $field => $default) {
                $value = is_array($saved) ? ($saved[$kind][$field] ?? null) : null;
                if ($value !== null && self::valid($kind, $field, $value)) {
                    $policy[$kind][$field] = $value;
                }
            }
        }
        return $policy;
    }

    public static function valid(string $kind, string $field, mixed $value): bool
    {
        if ($field === 'enabled') {
            return is_bool($value);
        }
        if ($field === 'at') {
            return is_string($value) && self::isClock($value);
        }
        [$min, $max] = self::LIMITS[$kind][$field] ?? [null, null];
        return $min !== null && is_int($value) && $value >= $min && $value <= $max;
    }

    public static function isClock(string $value): bool
    {
        return (bool) preg_match('/^([01][0-9]|2[0-3]):[0-5][0-9]$/', $value);
    }

    /**
     * backups.json'daki eski (ortam değişkeninden) plan alanlarını geçerli planla değiştirir — Genel bakış, Sistem bilgisi
     * ve Disk kullanımı ▸ Yedekler bunları gösterir.
     */
    public static function summaryFields(): array
    {
        $p = self::get();
        return [
            'keep_full' => $p['full']['keep'],
            'keep_config' => $p['config']['keep'],
            'keep_files' => $p['files']['keep'],
            'full_at' => $p['full']['at'],
            'files_at' => $p['files']['at'],
            'config_every_hours' => $p['config']['every_hours'],
        ];
    }
}
