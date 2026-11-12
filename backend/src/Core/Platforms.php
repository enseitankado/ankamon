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
 * İşletim sistemine göre işlev tanımı (platforms/catalog.json — kullanıcı isteği 2026-11-12; bkz. platforms/README.md).
 * Ön yüz GET /api/platforms ile, worker ankamon/platforms.py ile aynı dosyayı okur.
 */
final class Platforms
{
    private static ?array $catalog = null;

    /** @return array<string,mixed> katalog (okunamazsa yalnız Linux'u bilen asgari tanım) */
    public static function catalog(): array
    {
        if (self::$catalog !== null) {
            return self::$catalog;
        }
        $dir = getenv('PLATFORMS_DIR') ?: dirname(getenv('ACTIONS_DIR') ?: '/app/actions') . '/platforms';
        $data = json_decode((string) @file_get_contents($dir . '/catalog.json'), true);
        if (!is_array($data)) {
            error_log("ankamon: platform kataloğu okunamadı: $dir/catalog.json");
            $data = ['families' => ['linux' => ['label' => 'Linux', 'script' => 'run.sh', 'shell' => 'bash']],
                'family_order' => ['linux'], 'default_family' => 'linux', 'unknown_function_families' => ['linux'], 'functions' => []];
        }
        unset($data['_comment']);
        return self::$catalog = $data;
    }

    /**
     * Hazır işlem dizininde betiği bulunan aileler (run.sh → linux, run.ps1 → windows, run.macos.sh → macos).
     * @return string[]
     */
    public static function actionFamilies(string $actionDir): array
    {
        $families = [];
        foreach (self::catalog()['families'] as $family => $def) {
            if (!empty($def['script']) && is_file($actionDir . '/' . $def['script'])) {
                $families[] = $family;
            }
        }
        return $families;
    }
}
