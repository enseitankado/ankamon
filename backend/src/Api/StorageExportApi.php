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
use Ankamon\Core\Db;
use Ankamon\Core\Request;
use Ankamon\Core\Storage;

/**
 * GET /api/storage/export — Disk kullanımı sekmelerinde "İndir" (kullanıcı isteği 2026-11-12): bir satırın kapsamındaki
 * veriyi dosya olarak verir. Kapsam parametreleri o sekmenin silme isteğiyle AYNIDIR (device, all, name, ids, kind,
 * names — bkz. frontend ui.DiskUsage specs, LogStatsApi/MetricStatsApi/JobStatsApi/... delete): silinecek ne ise
 * indirilen de odur. Biçimler:
 *  - veritabanı satırları (loglar, sensör ölçümleri, sohbet, oturum hareketleri, ntfy): gzip'li CSV — sunucu tarafı
 *    imleçle parça parça okunup akıtılır (milyonlarca satırda da bellek sabit);
 *  - görevler ve bakım raporları: gzip'li NDJSON (satır başına bir görev: cihaz sonuçları ve çıktı akışıyla);
 *  - ekran görüntüleri: tar (JPEG'ler zaten sıkıştırılmış);
 *  - yedekler ve log kuyruğu: dosyalar root'a ait — storage-ops servisi indirme dosyasını hazırlar, nginx verir
 *    (X-Accel-Redirect /_exports/; bkz. docker/rootfs/services/storage-ops.sh export_files).
 */
final class StorageExportApi
{
    /** Ekran görüntülerinin dizini (bkz. ScreenshotsApi). */
    private const SHOTS_DIR = '/data/screenshots';
    /** İmleçten tek seferde okunan satır. */
    private const FETCH = 5000;

    public function export(Request $request, array $user): array
    {
        $mode = (string) $request->query('mode', '');
        set_time_limit(0);
        Audit::log($user, $request, 'storage.export', $mode, array_filter([
            'device' => $request->query('device'), 'all' => $request->query('all'), 'name' => $request->query('name'),
            'ids' => $request->query('ids'), 'kind' => $request->query('kind'), 'names' => $request->query('names'),
        ], static fn($v) => $v !== null));
        match ($mode) {
            'system', 'command' => $this->logs($request, $mode),
            'metrics' => $this->metrics($request),
            'jobs', 'diagnose' => $this->jobs($request, $mode),
            'chat' => $this->named($request, 'sohbet', 'chat_messages', 'device_name',
                'sent_at, device_name, session_username, direction, author, body', 'sent_at'),
            'movements' => $this->named($request, 'oturum-hareketleri', 'session_activity', 'device_name',
                'at, device_name, username, kind, summary, detail, source', 'at'),
            'ntfy' => $this->named($request, 'ntfy', 'ntfy_messages', 'rule_name',
                'sent_at, rule_name, topic, title, body, device_id, kind, status, error', 'sent_at'),
            'screenshots' => $this->screenshots($request),
            'backups' => $this->rootExport('backups', self::backupNames($request)),
            'queue' => $this->rootExport('logqueue', self::queueNames($request)),
            default => throw ApiError::badRequest('Bilinmeyen veri türü: ' . $mode),
        };
        exit;
    }

    /** Sistem / komut logları; device = id | "unmatched" | yok (tümü) — LogStatsApi::delete ile aynı kapsam. */
    private function logs(Request $request, string $type): void
    {
        $device = $request->query('device');
        $where = [];
        $params = [];
        $scope = 'tum-cihazlar';
        if ($type === 'command') {
            if ($device === 'unmatched') {
                $where[] = 'device_id IS NULL';
                $scope = 'eslesmeyen';
            } elseif ($device !== null) {
                $where[] = 'device_id = ?';
                $params[] = (int) $device;
                $scope = self::deviceSlug((int) $device);
            }
            $sql = 'SELECT time, device_name, username, source, command, exit_code, status FROM command_log'
                . ($where ? ' WHERE ' . implode(' AND ', $where) : '') . ' ORDER BY time';
            $header = ['zaman', 'cihaz', 'kullanici', 'kaynak', 'komut', 'cikis_kodu', 'durum'];
        } else {
            if ($device === 'unmatched') {
                $where[] = 'NOT EXISTS (SELECT 1 FROM devices b WHERE lower(b.hostname) = lower(logs.host) OR host(b.ip) = logs.from_ip)';
                $scope = 'eslesmeyen';
            } elseif ($device !== null) {
                $b = Db::one('SELECT hostname, host(ip) AS ip FROM devices WHERE id = ?', [(int) $device])
                    ?? throw ApiError::notFound('Cihaz bulunamadı.');
                $where[] = '(lower(host) = lower(?) OR from_ip = ?)';
                array_push($params, (string) $b['hostname'], (string) $b['ip']);
                $scope = self::deviceSlug((int) $device);
            }
            $sql = 'SELECT received_at, device_time, host, from_ip, facility, severity, program, message FROM logs'
                . ($where ? ' WHERE ' . implode(' AND ', $where) : '') . ' ORDER BY received_at';
            $header = ['alinma', 'cihaz_zamani', 'host', 'ip', 'facility', 'severity', 'program', 'mesaj'];
        }
        $this->csv(($type === 'command' ? 'komut-loglari-' : 'sistem-loglari-') . $scope, $header, $sql, $params);
    }

    /** Ham sensör ölçümleri (özetler değil); device = id | "unmatched" | yok — MetricStatsApi::delete ile aynı kapsam. */
    private function metrics(Request $request): void
    {
        $device = $request->query('device');
        $where = '';
        $params = [];
        $scope = 'tum-cihazlar';
        if ($device === 'unmatched') {
            $where = " WHERE NULLIF(t.device_id, '') IS NULL OR NOT EXISTS (SELECT 1 FROM devices b WHERE b.id::text = t.device_id)";
            $scope = 'eslesmeyen';
        } elseif ($device !== null) {
            $where = ' WHERE t.device_id = ?';
            $params[] = (string) (int) $device;
            $scope = self::deviceSlug((int) $device);
        }
        $this->csv('sensor-verileri-' . $scope,
            ['zaman', 'cihaz_id', 'olcum', 'cpu', 'mode', 'device', 'mountpoint', 'fstype', 'chip', 'sensor', 'type', 'zone', 'deger'],
            "SELECT m.time, t.device_id, t.name, t.cpu, t.mode, t.device, t.mountpoint, t.fstype, t.chip, t.sensor, t.type, t.zone, m.value
             FROM metrics m JOIN metrics_tag t USING (tag_id)$where ORDER BY m.time",
            $params);
    }

    /** Ad başına tutulan tablolar (sohbet, oturum hareketleri, ntfy): all=1 ya da name=<ad>; ntfy'de ids de olur. */
    private function named(Request $request, string $file, string $table, string $nameColumn, string $columns, string $order): void
    {
        $params = [];
        if ($request->query('all') === '1') {
            $where = '';
            $scope = 'tumu';
        } elseif (($name = (string) $request->query('name', '')) !== '') {
            $where = " WHERE $nameColumn = ?";
            $params[] = $name;
            $scope = self::slug($name);
        } elseif (($ids = self::ids($request)) !== []) {
            $where = ' WHERE id = ANY(?::bigint[])';
            $params[] = '{' . implode(',', $ids) . '}';
            $scope = count($ids) . '-kayit';
        } else {
            throw ApiError::badRequest('İndirilecek kapsam seçilmedi.');
        }
        $this->csv("$file-$scope", array_map('trim', explode(',', $columns)),
            "SELECT $columns FROM $table$where ORDER BY $order", $params);
    }

    /** Görev kuyruğu / bakım raporları: all=1 (bitmişlerin tümü — silmeyle aynı) ya da ids. NDJSON, görev başına satır. */
    private function jobs(Request $request, string $mode): void
    {
        $scopeSql = $mode === 'diagnose' ? "type = 'diagnose'" : "type <> 'diagnose'";
        if ($request->query('all') === '1') {
            $ids = array_map('intval', array_column(Db::all(
                "SELECT id FROM jobs WHERE $scopeSql AND status IN ('done', 'failed') ORDER BY id"), 'id'));
            $scope = 'bitmis-tumu';
        } else {
            $ids = self::ids($request);
            if (!$ids) {
                throw ApiError::badRequest('İndirilecek görev seçilmedi.');
            }
            $scope = count($ids) === 1 ? (string) $ids[0] : count($ids) . '-gorev';
        }
        $gz = self::start(($mode === 'diagnose' ? 'bakim-raporlari-' : 'gorevler-') . $scope . '.ndjson.gz', 'application/gzip');
        foreach (array_chunk($ids, 200) as $chunk) {
            $list = '{' . implode(',', $chunk) . '}';
            $jobs = Db::all("SELECT j.*, u.username AS created_by_name FROM jobs j LEFT JOIN users u ON u.id = j.created_by
                             WHERE j.$scopeSql AND j.id = ANY(?::bigint[]) ORDER BY j.id", [$list]);
            foreach ($jobs as $job) {
                $job['params'] = json_decode((string) $job['params'], true);
                $job['targets'] = Db::all('SELECT t.device_id, b.hostname, b.label, t.status, t.exit_code, t.started_at, t.finished_at, t.output
                                           FROM job_targets t LEFT JOIN devices b ON b.id = t.device_id WHERE t.job_id = ? ORDER BY t.device_id', [$job['id']]);
                $job['events'] = Db::all('SELECT time, device_id, kind, text FROM job_events WHERE job_id = ? ORDER BY id', [$job['id']]);
                self::write($gz, json_encode($job, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE) . "\n");
            }
        }
        self::finish($gz);
    }

    /** Ekran görüntüleri: all=1 ya da name=<cihaz adı> — tar, içinde kayıtlı göreli yollarıyla. */
    private function screenshots(Request $request): void
    {
        if ($request->query('all') === '1') {
            $files = array_column(Db::all('SELECT file FROM screenshots ORDER BY taken_at'), 'file');
            $scope = 'tumu';
        } else {
            $name = (string) $request->query('name', '');
            if ($name === '') {
                throw ApiError::badRequest('İndirilecek kapsam seçilmedi.');
            }
            $files = array_column(Db::all('SELECT file FROM screenshots WHERE device_name = ? ORDER BY taken_at', [$name]), 'file');
            $scope = self::slug($name);
        }
        // Yalnız dizin içindeki düz göreli yollar (kayıt bozuksa dışarı çıkılamasın).
        $files = array_values(array_filter($files, static fn($f) => is_string($f) && $f !== '' && !str_contains($f, '..')
            && $f[0] !== '/' && is_file(self::SHOTS_DIR . '/' . $f)));
        if (!$files) {
            throw ApiError::notFound('İndirilecek ekran görüntüsü yok.');
        }
        $list = tempnam(sys_get_temp_dir(), 'shots');
        file_put_contents($list, implode("\n", $files) . "\n");
        self::start("ekran-goruntuleri-$scope.tar", 'application/x-tar', false);
        $proc = popen('tar -cf - -C ' . escapeshellarg(self::SHOTS_DIR) . ' -T ' . escapeshellarg($list), 'r');
        if ($proc) {
            while (!feof($proc)) {
                echo fread($proc, 65536);
                flush();
            }
            pclose($proc);
        }
        @unlink($list);
    }

    /** Root'a ait dosyalar: storage-ops indirme dosyasını hazırlar (bkz. export_files), nginx verir. */
    private function rootExport(string $kind, array $names): void
    {
        $file = Storage::rootRequestText('export', array_merge([$kind], $names), 300);
        if ($file === '' || $file === '0' || !preg_match('/^[0-9]{8}-[0-9]{6}-[0-9a-f]{8}-[A-Za-z0-9._-]+$/', $file)) {
            throw ApiError::notFound('İndirilecek dosya bulunamadı.');
        }
        // Ad: hazırlık önekini (zaman-kimlik-) at; tek yedek dosyası kendi adıyla iner.
        $download = preg_replace('/^[0-9]{8}-[0-9]{6}-[0-9a-f]{8}-/', '', $file);
        header('Content-Type: ' . (str_ends_with($file, '.gz') ? 'application/gzip' : 'application/octet-stream'));
        header('Content-Disposition: attachment; filename="' . $download . '"');
        header('X-Accel-Redirect: /_exports/' . rawurlencode($file));
    }

    /** Yedekler sekmesinin kapsamı → storage-ops satırları (BackupStatsApi::delete ile aynı doğrulama). */
    private static function backupNames(Request $request): array
    {
        if ($request->query('all') === '1') {
            return ['*'];
        }
        if (($kind = $request->query('kind')) !== null) {
            if (!in_array($kind, BackupStatsApi::KINDS, true)) {
                throw ApiError::badRequest('Geçersiz yedek türü: ' . $kind);
            }
            return ["$kind:*"];
        }
        $names = array_values(array_unique(array_filter(explode(',', (string) $request->query('names', '')))));
        foreach ($names as $name) {
            if (!preg_match(BackupStatsApi::NAME, $name)) {
                throw ApiError::badRequest('Geçersiz yedek dosyası adı: ' . $name);
            }
        }
        return $names ?: throw ApiError::badRequest('İndirilecek yedek seçilmedi.');
    }

    /** Log kuyruğu sekmesinin kapsamı: all=1 (canlı + bozuk klasörler) ya da names (live | bozuk-…). */
    private static function queueNames(Request $request): array
    {
        if ($request->query('all') === '1') {
            $names = ['live'];
            foreach (@scandir('/data/rsyslog') ?: [] as $name) {
                if (preg_match('/^bozuk-[0-9]{8}-[0-9]{6}$/', $name)) {
                    $names[] = $name;
                }
            }
            return $names;
        }
        $names = array_values(array_unique(array_filter(explode(',', (string) $request->query('names', '')))));
        foreach ($names as $name) {
            if ($name !== 'live' && !preg_match('/^bozuk-[0-9]{8}-[0-9]{6}$/', $name)) {
                throw ApiError::badRequest('Geçersiz kuyruk adı: ' . $name);
            }
        }
        return $names ?: throw ApiError::badRequest('İndirilecek kuyruk seçilmedi.');
    }

    /** Sorguyu sunucu tarafı imleçle okuyup gzip'li CSV olarak akıtır. */
    private function csv(string $file, array $header, string $sql, array $params): void
    {
        $pdo = Db::pdo();
        $pdo->beginTransaction();
        // DECLARE parametre almaz (yardımcı komut): değerler istemci tarafında güvenle tırnaklanır.
        $declare = $pdo->prepare('DECLARE ankamon_export NO SCROLL CURSOR FOR ' . $sql, [\PDO::ATTR_EMULATE_PREPARES => true]);
        $declare->execute($params);
        $gz = self::start("$file.csv.gz", 'application/gzip');
        self::write($gz, "\u{FEFF}" . self::csvLine($header));
        $fetch = $pdo->prepare('FETCH ' . self::FETCH . ' FROM ankamon_export');
        do {
            $fetch->execute();
            $rows = $fetch->fetchAll(\PDO::FETCH_NUM);
            $chunk = '';
            foreach ($rows as $row) {
                $chunk .= self::csvLine($row);
            }
            if ($chunk !== '') {
                self::write($gz, $chunk);
            }
        } while (count($rows) === self::FETCH && !connection_aborted());
        $pdo->exec('CLOSE ankamon_export');
        $pdo->commit();
        self::finish($gz);
    }

    /** İndirme başlıklarını yazar, çıktı tamponlarını kapatır; gzip ise sıkıştırma bağlamını döner. */
    private static function start(string $file, string $type, bool $gzip = true): ?\DeflateContext
    {
        while (ob_get_level() > 0) {
            ob_end_clean();
        }
        header('Content-Type: ' . $type);
        header('Content-Disposition: attachment; filename="ankamon-' . $file . '"');
        header('Cache-Control: no-store');
        // nginx yanıtı geçici dosyada biriktirmesin: büyük indirmeler akarak gelir.
        header('X-Accel-Buffering: no');
        return $gzip ? deflate_init(ZLIB_ENCODING_GZIP, ['level' => 6]) : null;
    }

    private static function write(?\DeflateContext $gz, string $data): void
    {
        echo $gz ? deflate_add($gz, $data, ZLIB_NO_FLUSH) : $data;
        flush();
    }

    private static function finish(?\DeflateContext $gz): void
    {
        if ($gz) {
            echo deflate_add($gz, '', ZLIB_FINISH);
        }
        flush();
    }

    private static function csvLine(array $row): string
    {
        return implode(',', array_map(static function ($v): string {
            $v = $v === null ? '' : (string) $v;
            return preg_match('/[",\r\n]/', $v) ? '"' . str_replace('"', '""', $v) . '"' : $v;
        }, $row)) . "\r\n";
    }

    /** @return list<int> */
    private static function ids(Request $request): array
    {
        return array_values(array_unique(array_filter(array_map('intval', explode(',', (string) $request->query('ids', ''))))));
    }

    private static function deviceSlug(int $id): string
    {
        $b = Db::one("SELECT COALESCE(NULLIF(label, ''), hostname, host(ip)) AS name FROM devices WHERE id = ?", [$id]);
        return self::slug($b['name'] ?? "cihaz-$id");
    }

    /** Dosya adına uygun ASCII kısaltma (Türkçe harfler sadeleşir). */
    private static function slug(string $text): string
    {
        $text = strtr($text, ['ç' => 'c', 'Ç' => 'C', 'ğ' => 'g', 'Ğ' => 'G', 'ı' => 'i', 'İ' => 'I', 'ö' => 'o', 'Ö' => 'O',
            'ş' => 's', 'Ş' => 'S', 'ü' => 'u', 'Ü' => 'U']);
        $text = trim((string) preg_replace('/[^A-Za-z0-9._-]+/', '-', $text), '-');
        return substr($text !== '' ? $text : 'kayit', 0, 60);
    }
}
