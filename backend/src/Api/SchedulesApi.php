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

use Ankamon\Core\Actions;
use Ankamon\Core\ApiError;
use Ankamon\Core\Audit;
use Ankamon\Core\Db;
use Ankamon\Core\Request;

/**
 * Kullanıcı tanımlı zamanlanmış görevler (Sistem ▸ Zamanlanmış görevler ▸ Görevler / Sonuçlar — yalnız yönetici;
 * kullanıcı isteği 2026-11-13). Görev tanımı kaydedilirken JobsApi::spec ile elle başlatılan görevin AYNI kurallarıyla
 * doğrulanır; zamanı gelince worker (tasks/user_schedules.py) görevi kuyruğa yazar — sonucu olağan yerlerine yansır
 * (SSH denetimi Sağlık ▸ Denetle/Durum, anomali taraması Sağlık). Sonuçlar listesi zamanlanmış görevlerin
 * çalıştırmalarını ve Ankamon'un kendi otomatik görevlerini (ör. haftalık otomatik SSH denetimi) birlikte gösterir.
 */
final class SchedulesApi
{
    /** Zamanlanabilen görev türleri → arayüzdeki ad (cihazla çalışan, onay/etkileşim istemeyen görevler). */
    public const TYPES = [
        'action' => 'Hazır işlem',
        'command' => 'Serbest komut',
        'diagnose' => 'SSH denetimi (tam)',
        'anomaly_scan' => 'Anomali taraması',
        'wol' => 'Uyandır (Wake-on-LAN)',
        'wake' => 'Ekranı uyandır',
        'sleep' => 'Ekranı uyut',
        'logout' => 'Oturumu kapat',
        'screen_lock' => 'Ekranı kilitle',
        'screen_unlock' => 'Ekran kilidini aç',
    ];

    // when_online: cihaz çevrimiçi olunca, cihaz başına bir kez (göç 061; worker tasks/user_schedules.py).
    private const REPEATS = ['once', 'interval', 'weekly', 'when_online'];
    private const TARGETS = ['devices', 'all_online'];

    public function index(Request $request, array $user): array
    {
        $schedules = Db::all(
            "SELECT s.id, s.name, s.enabled, s.job_type, s.job_title, s.job_request, s.target_mode, s.device_ids,
                    s.repeat, extract(epoch FROM s.run_at)::bigint AS run_at, s.interval_minutes,
                    to_char(s.time_of_day, 'HH24:MI') AS time_of_day, s.weekdays,
                    extract(epoch FROM s.next_run_at)::bigint AS next_run_at,
                    extract(epoch FROM s.last_run_at)::bigint AS last_run_at, s.last_job_id, s.run_requested, s.fired_device_ids,
                    j.status AS last_status, j.summary AS last_summary, u.username AS created_by,
                    (SELECT string_agg(COALESCE(NULLIF(d.label, ''), d.hostname, host(d.ip)), ', ' ORDER BY d.label)
                       FROM devices d WHERE d.id = ANY(s.device_ids)) AS device_names
             FROM user_schedules s
             LEFT JOIN jobs j ON j.id = s.last_job_id
             LEFT JOIN users u ON u.id = s.created_by
             ORDER BY s.name, s.id"
        );
        foreach ($schedules as &$s) {
            $s['job_request'] = json_decode((string) $s['job_request'], true) ?: new \stdClass();
            $s['device_ids'] = self::intArray($s['device_ids']);
            $s['weekdays'] = self::intArray($s['weekdays']);
            $s['fired_device_ids'] = self::intArray($s['fired_device_ids']);
        }
        unset($s);
        return ['schedules' => $schedules, 'runs' => self::runs(), 'types' => self::TYPES];
    }

    /**
     * Sonuçlar: zamanlanmış görev çalıştırmaları + Ankamon'un kendi otomatik görevleri (created_by boş), son 30 gün.
     */
    private static function runs(): array
    {
        $counts = "(SELECT count(*) FROM job_targets t WHERE t.job_id = j.id) AS targets,
                   (SELECT count(*) FROM job_targets t WHERE t.job_id = j.id AND t.status = 'ok') AS ok,
                   (SELECT count(*) FROM job_targets t WHERE t.job_id = j.id AND t.status = 'failed') AS failed,
                   (SELECT count(*) FROM job_targets t WHERE t.job_id = j.id AND t.status = 'unreachable') AS unreachable,
                   (SELECT count(*) FROM job_targets t WHERE t.job_id = j.id AND t.status = 'skipped') AS skipped";
        return Db::all(
            "SELECT * FROM (
               SELECT 'schedule' AS source, r.schedule_id, r.schedule_name AS name, r.manual, r.note,
                      extract(epoch FROM r.fired_at)::bigint AS fired_at,
                      j.id AS job_id, j.type, j.title, j.status, j.summary,
                      extract(epoch FROM j.finished_at)::bigint AS finished_at, $counts
               FROM user_schedule_runs r LEFT JOIN jobs j ON j.id = r.job_id
               WHERE r.fired_at > now() - interval '30 days'
               UNION ALL
               SELECT 'auto', NULL, j.title, false, NULL, extract(epoch FROM j.created_at)::bigint,
                      j.id, j.type, j.title, j.status, j.summary, extract(epoch FROM j.finished_at)::bigint, $counts
               FROM jobs j
               WHERE j.created_by IS NULL AND j.created_at > now() - interval '30 days'
                 AND NOT EXISTS (SELECT 1 FROM user_schedule_runs r WHERE r.job_id = j.id)
             ) x ORDER BY fired_at DESC LIMIT 600"
        );
    }

    /** POST /api/schedules — yeni zamanlama ya da (id ile) düzenleme. */
    public function save(Request $request, array $user): array
    {
        $id = (int) $request->input('id', 0);
        $name = trim((string) $request->input('name', ''));
        if ($name === '' || mb_strlen($name) > 120) {
            throw ApiError::badRequest('Görev adı boş olamaz (en çok 120 karakter).');
        }
        $job = $request->input('job', []);
        if (!is_array($job) || !array_key_exists((string) ($job['type'] ?? ''), self::TYPES)) {
            throw ApiError::badRequest('Zamanlanamayan görev türü.');
        }
        unset($job['device_ids'], $job['board_ids'], $job['all_online']);
        if ($job['type'] === 'action') {
            // Parola gibi gizli değer isteyen hazır işlemler zamanlanmaz: gizli değer veritabanında açık saklanmasın.
            $action = Actions::all()[(string) ($job['action'] ?? '')] ?? null;
            if (!empty($action['ui'])) {
                // Kendi penceresi olan hazır komut (ör. Disk editörü) zamanlanmaz.
                throw ApiError::badRequest($action['title'] . ' kendi penceresinde çalışır; zamanlanamaz.');
            }
            // Boş bırakılan gizli parametre saklanacak bir sır taşımaz (ör. TiHA adımı tahtadaki mevcut ayarlarıyla
            // uygulanır, değer paketi boş — kullanıcı isteği 2026-11-23): yalnız DOLU gizli değer reddedilir.
            foreach ($action['params'] ?? [] as $param) {
                $given = trim((string) (((array) ($job['values'] ?? []))[$param['key']] ?? $param['default'] ?? ''));
                if (($param['type'] ?? 'text') === 'password' && $given !== '') {
                    throw ApiError::badRequest('Parola isteyen hazır işlemler zamanlanamaz (gizli değer saklanmaz).');
                }
            }
        }
        // Elle başlatılan görevin AYNI doğrulaması ve yetki denetimi.
        [$type, , $title, $params, $needsDevices] = (new JobsApi())->spec(Request::fromBody($job), $user);

        $mode = (string) $request->input('target_mode', 'devices');
        if (!in_array($mode, self::TARGETS, true)) {
            throw ApiError::badRequest('Geçersiz hedef.');
        }
        $deviceIds = array_values(array_unique(array_filter(array_map('intval', (array) $request->input('device_ids', [])))));
        if ($mode === 'devices') {
            if (!$deviceIds && $needsDevices) {
                throw ApiError::badRequest('En az bir cihaz seçin.');
            }
            $known = (int) Db::value('SELECT count(*) FROM devices WHERE id = ANY(?::int[])', ['{' . implode(',', $deviceIds) . '}']);
            if ($known !== count($deviceIds)) {
                throw ApiError::badRequest('Seçilen cihazlardan bazıları bulunamadı.');
            }
        } else {
            $deviceIds = [];
        }

        $repeat = (string) $request->input('repeat', '');
        if (!in_array($repeat, self::REPEATS, true)) {
            throw ApiError::badRequest('Geçersiz yineleme.');
        }
        $runAt = $request->input('run_at');
        $runAt = $runAt === null || $runAt === '' ? null : (int) $runAt;
        $interval = null;
        $timeOfDay = null;
        $weekdays = [1, 2, 3, 4, 5, 6, 7];
        if ($repeat === 'when_online') {
            if ($mode !== 'devices' || !$deviceIds) {
                throw ApiError::badRequest('"Çevrimiçi olunca" için hedef cihazları seçin.');
            }
            $runAt = null;
        } elseif ($repeat === 'once') {
            if (!$runAt) {
                throw ApiError::badRequest('Çalışma zamanını seçin.');
            }
            if ($runAt <= time()) {
                throw ApiError::badRequest('Çalışma zamanı geçmişte kalıyor.');
            }
        } elseif ($repeat === 'interval') {
            $interval = (int) $request->input('interval_minutes', 0);
            if ($interval < 5 || $interval > 60 * 24 * 31) {
                throw ApiError::badRequest('Aralık 5 dakika ile 31 gün arasında olmalı.');
            }
        } else {
            $timeOfDay = (string) $request->input('time_of_day', '');
            if (!preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', $timeOfDay)) {
                throw ApiError::badRequest('Saat SS:DD biçiminde olmalı.');
            }
            $weekdays = array_values(array_unique(array_filter(array_map('intval', (array) $request->input('weekdays', [])),
                static fn(int $d) => $d >= 1 && $d <= 7)));
            sort($weekdays);
            if (!$weekdays) {
                throw ApiError::badRequest('En az bir gün seçin.');
            }
            $runAt = null;
        }
        $enabled = (bool) $request->input('enabled', true);

        $values = [
            $name, $enabled, $type, $title, json_encode($params ?: new \stdClass(), JSON_UNESCAPED_UNICODE),
            json_encode($job, JSON_UNESCAPED_UNICODE), $mode, '{' . implode(',', $deviceIds) . '}', $repeat,
            $runAt, $interval, $timeOfDay, '{' . implode(',', $weekdays) . '}',
        ];
        // next_run_at boşaltılır: worker (≤10 sn) yeni zamanı hesaplar (tek hesap yeri — tasks/user_schedules.py).
        if ($id) {
            $updated = Db::exec(
                "UPDATE user_schedules SET name = ?, enabled = ?, job_type = ?, job_title = ?, job_params = ?::jsonb,
                        job_request = ?::jsonb, target_mode = ?, device_ids = ?::int[], repeat = ?,
                        run_at = to_timestamp(?::bigint), interval_minutes = ?::int, time_of_day = ?::time,
                        weekdays = ?::smallint[], next_run_at = NULL, fired_device_ids = '{}', updated_at = now()
                 WHERE id = ?",
                array_merge($values, [$id])
            );
            if (!$updated) {
                throw ApiError::notFound();
            }
        } else {
            $id = (int) Db::value(
                "INSERT INTO user_schedules (name, enabled, job_type, job_title, job_params, job_request, target_mode,
                        device_ids, repeat, run_at, interval_minutes, time_of_day, weekdays, created_by)
                 VALUES (?, ?, ?, ?, ?::jsonb, ?::jsonb, ?, ?::int[], ?, to_timestamp(?::bigint), ?::int, ?::time,
                        ?::smallint[], ?) RETURNING id",
                array_merge($values, [$user['id']])
            );
        }
        Audit::log($user, $request, 'schedule.save', $name, ['id' => $id, 'type' => $type, 'repeat' => $repeat,
            'target_mode' => $mode, 'devices' => $deviceIds]);
        return ['id' => $id];
    }

    /**
     * POST /api/schedules/when-online {job, device_ids, name?} — "cihaz çevrimiçi olunca, bir kez" çalışacak görev
     * (kullanıcı isteği 2026-11-24: ör. Bakım ▸ Ahenk ▸ ETA Kayıt güncelle'de işaretli cihazların çevrimdışı olanları).
     * Zamanlama listesi yönetici sayfasında olduğu halde bu uç görevi elle başlatabilen kullanıcıya açıktır: görev tanımı
     * save() içinde JobsApi::spec'ten (yetki dahil) geçer; yineleme ve hedef sabittir.
     */
    public function whenOnline(Request $request, array $user): array
    {
        $job = $request->input('job', []);
        if (!is_array($job)) {
            throw ApiError::badRequest('Geçersiz görev.');
        }
        $name = trim((string) $request->input('name', ''));
        return $this->save(Request::fromBody([
            'name' => $name !== '' ? mb_substr($name, 0, 120) : 'Çevrimiçi olunca — ' . ($job['type'] ?? 'görev'),
            'job' => $job, 'target_mode' => 'devices', 'device_ids' => (array) $request->input('device_ids', []),
            'repeat' => 'when_online', 'enabled' => true,
        ]), $user);
    }

    /** PUT /api/schedules/{id}/enabled {enabled} */
    public function setEnabled(Request $request, array $user): array
    {
        $enabled = (bool) $request->input('enabled', true);
        $row = Db::one(
            "UPDATE user_schedules SET enabled = ?, next_run_at = NULL, updated_at = now() WHERE id = ?
             RETURNING name, repeat, run_at",
            [$enabled, $request->arg('id')]
        ) ?? throw ApiError::notFound();
        Audit::log($user, $request, $enabled ? 'schedule.enable' : 'schedule.disable', $row['name']);
        return ['ok' => true];
    }

    /** POST /api/schedules/{id}/run — zamanlamaya dokunmadan bir kez çalıştırır (worker ≤10 sn içinde başlatır). */
    public function runNow(Request $request, array $user): array
    {
        $name = Db::value('UPDATE user_schedules SET run_requested = true WHERE id = ? RETURNING name', [$request->arg('id')])
            ?? throw ApiError::notFound();
        Audit::log($user, $request, 'schedule.run', (string) $name);
        return ['ok' => true];
    }

    /** DELETE /api/schedules/{id} — geçmiş çalıştırmalar (Sonuçlar) korunur. */
    public function delete(Request $request, array $user): array
    {
        $name = Db::value('DELETE FROM user_schedules WHERE id = ? RETURNING name', [$request->arg('id')])
            ?? throw ApiError::notFound();
        Audit::log($user, $request, 'schedule.delete', (string) $name);
        return ['ok' => true];
    }

    /** PostgreSQL dizi metni ("{1,2}") → tamsayı listesi. */
    private static function intArray(mixed $value): array
    {
        $text = trim((string) $value, '{}');
        return $text === '' ? [] : array_map('intval', explode(',', $text));
    }
}
