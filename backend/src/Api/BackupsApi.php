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

namespace Ankamon\Api;

use Ankamon\Core\ApiError;
use Ankamon\Core\Audit;
use Ankamon\Core\BackupPolicy;
use Ankamon\Core\DataStores;
use Ankamon\Core\Request;
use Ankamon\Core\Settings;

/**
 * Sistem ▸ Yedekler (kullanıcı isteği 2026-11-12): Ankamon'daki bütün yedeklemelerin tek kontrol paneli — plan
 * (aç/kapa, zamanlama, saklama), son sonuçlar, "Şimdi al" ve veri depolarının hangi yedeğe girdiği. Yedekleri
 * docker/backup/backup.sh (root) alır; plan settings.backup_policy, anlık istek settings.backup_run, son sonuçlar
 * /run/ankamon/backup-status.json, dosya listesi /run/ankamon/backups.json. Dosyaların kendisi Disk kullanımı ▸ Yedekler'de.
 */
final class BackupsApi
{
    private const STATUS = '/run/ankamon/backup-status.json';
    private const SUMMARY = '/run/ankamon/backups.json';
    /** Yedek türleri; dosya önekleri (grafana yapılandırmayla birlikte alınır). */
    private const KINDS = ['config' => ['config', 'grafana'], 'full' => ['full'], 'files' => ['files'], 'home' => []];

    public function index(): array
    {
        $status = self::json(self::STATUS);
        $summary = self::json(self::SUMMARY);
        $files = [];
        foreach (($summary['files'] ?? []) as $f) {
            $prefix = (string) strtok((string) $f['name'], '-');
            $kind = $prefix === 'grafana' ? 'config' : ($prefix === 'pre' ? 'pre' : $prefix);
            $files[$kind]['count'] = ($files[$kind]['count'] ?? 0) + 1;
            $files[$kind]['bytes'] = ($files[$kind]['bytes'] ?? 0) + (int) $f['bytes'];
            $files[$kind]['newest'] = max($files[$kind]['newest'] ?? 0, (int) $f['mtime']);
        }
        // Ev dizini yedekleri: görev dizini sayısı ve toplam boyut (dizin herkese okunur — bkz. worker executor/backup.py).
        $home = ['count' => 0, 'bytes' => 0, 'newest' => 0];
        foreach (glob('/data/home-backups/job-*', GLOB_ONLYDIR) ?: [] as $dir) {
            $home['count']++;
            $home['newest'] = max($home['newest'], (int) @filemtime($dir));
            foreach (glob("$dir/*") ?: [] as $file) {
                $home['bytes'] += (int) @filesize($file);
            }
        }
        $files['home'] = $home;
        return [
            'policy' => BackupPolicy::get(),
            'defaults' => BackupPolicy::defaults(),
            'limits' => BackupPolicy::LIMITS,
            'status' => $status ?: null,
            'files' => $files ?: new \stdClass(),
            'dir' => $summary['dir'] ?? '/data/backups',
            'stores' => DataStores::all(),
        ];
    }

    /** PUT /api/backups/policy — {config:{enabled, every_hours, keep}, full:{enabled, at, keep}, files:{…}, home:{keep_hours}}. */
    public function update(Request $request, array $user): array
    {
        $body = $request->body();
        $policy = BackupPolicy::get();
        foreach ($policy as $kind => $fields) {
            foreach (array_keys($fields) as $field) {
                if (!isset($body[$kind]) || !is_array($body[$kind]) || !array_key_exists($field, $body[$kind])) {
                    continue;
                }
                $value = $body[$kind][$field];
                if (!BackupPolicy::valid($kind, $field, $value)) {
                    throw ApiError::badRequest("Geçersiz değer: $kind.$field");
                }
                $policy[$kind][$field] = $value;
            }
        }
        Settings::set('backup_policy', $policy);
        Audit::log($user, $request, 'backups.policy', '', $policy);
        return ['ok' => true, 'policy' => $policy];
    }

    /** POST /api/backups/run — {kind}: yedekleme servisi 10 sn içinde alır (bkz. backup.sh "Şimdi al"). */
    public function run(Request $request, array $user): array
    {
        $kind = (string) $request->input('kind', '');
        if (!array_key_exists($kind, self::KINDS)) {
            throw ApiError::badRequest('Geçersiz yedek türü.');
        }
        $pending = Settings::get('backup_run');
        $kinds = array_values(array_unique(array_merge(is_array($pending) ? ($pending['kinds'] ?? []) : [], [$kind])));
        Settings::set('backup_run', ['kinds' => $kinds]);
        Audit::log($user, $request, 'backups.run', $kind);
        return ['ok' => true, 'queued' => $kinds];
    }

    private static function json(string $path): array
    {
        $raw = @file_get_contents($path);
        $data = $raw === false ? null : json_decode($raw, true);
        return is_array($data) ? $data : [];
    }
}
