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
use Ankamon\Core\Settings;
use Ankamon\Core\Storage;

/**
 * Anomaliler ▸ Bildirimler: ntfy konusu, kurallar ve gönderilen bildirimler. Gönderimi worker yapar (bkz. worker
 * tasks/ntfy_notify.py, executor/ntfy.py); deneme bildirimi de "ntfy_test" görevidir.
 */
final class NtfyApi
{
    private const MODES = ['live', 'scan', 'history', 'summary'];

    /** Çalışma biçimine göre seçilebilen aralıklar (dakika): worker'da bu değerlerle çalışır, arayüz aynı listeyi gösterir. */
    public const INTERVALS = [
        'live' => [0, 15, 60, 240, 1440],
        'scan' => [15, 30, 60, 180, 360, 1440],
        'history' => [60, 180, 360, 1440],
        'summary' => [360, 1440, 10080],
    ];

    public function index(): array
    {
        $rules = Db::all(
            "SELECT id, name, array_to_json(board_ids) AS board_ids, array_to_json(kinds) AS kinds, mode, interval_minutes, max_per_hour, enabled,
                    extract(epoch FROM last_run_at)::bigint AS last_run_at
             FROM ntfy_rules ORDER BY id"
        );
        foreach ($rules as &$rule) {
            $rule['board_ids'] = json_decode((string) $rule['board_ids'], true) ?: [];
            $rule['kinds'] = json_decode((string) $rule['kinds'], true) ?: [];
        }
        unset($rule);
        return [
            'config' => Settings::get('ntfy'),
            'organization' => Settings::get('organization'),
            'rules' => $rules,
            'intervals' => self::INTERVALS,
            'kinds' => AnomaliesApi::kinds(),
            'messages' => Db::all(
                "SELECT id, extract(epoch FROM sent_at)::bigint AS sent_at, rule_name, topic, title, body, status, error
                 FROM ntfy_messages ORDER BY sent_at DESC, id DESC LIMIT 1000"
            ),
        ];
    }

    public function saveConfig(Request $request, array $user): array
    {
        $server = rtrim(trim((string) $request->input('server', 'https://ntfy.sh')), '/');
        if (!preg_match('#^https?://[A-Za-z0-9.:\[\]_-]+(/[A-Za-z0-9._/-]*)?$#', $server)) {
            throw ApiError::badRequest('Geçersiz sunucu adresi.');
        }
        $topic = trim((string) $request->input('topic', ''));
        if ($topic !== '' && !preg_match('/^[A-Za-z0-9_-]{1,64}$/', $topic)) {
            throw ApiError::badRequest('Konu adı yalnız harf, rakam, - ve _ içerebilir (en çok 64 karakter).');
        }
        Settings::set('ntfy', ['server' => $server, 'topic' => $topic]);
        Audit::log($user, $request, 'ntfy.config', $server);
        return ['ok' => true];
    }

    private function ruleInput(Request $request): array
    {
        $name = trim((string) $request->input('name', ''));
        if ($name === '' || mb_strlen($name) > 80) {
            throw ApiError::badRequest('Kural adı gerekli (en çok 80 karakter).');
        }
        $mode = (string) $request->input('mode', 'live');
        if (!in_array($mode, self::MODES, true)) {
            throw ApiError::badRequest('Geçersiz çalışma biçimi.');
        }
        $interval = (int) $request->input('interval_minutes', 60);
        if (!in_array($interval, self::INTERVALS[$mode], true)) {
            throw ApiError::badRequest('Bu çalışma biçimi için geçersiz aralık.');
        }
        $kinds = array_values(array_intersect(array_keys(AnomaliesApi::kinds()), array_map('strval', (array) $request->input('kinds', []))));
        if ($mode === 'scan' && $kinds && !array_intersect($kinds, array_keys(AnomaliesApi::scannable()))) {
            throw ApiError::badRequest('Seçilen türler taranamıyor.');
        }
        return [
            $name,
            '{' . implode(',', array_map('intval', (array) $request->input('board_ids', []))) . '}',
            '{' . implode(',', array_map(static fn(string $k) => '"' . $k . '"', $kinds)) . '}',
            $mode, $interval,
            max(1, min(600, (int) $request->input('max_per_hour', 20))),
            (bool) $request->input('enabled', true) ? 'true' : 'false',
        ];
    }

    public function createRule(Request $request, array $user): array
    {
        $values = $this->ruleInput($request);
        $id = Db::value(
            'INSERT INTO ntfy_rules (name, board_ids, kinds, mode, interval_minutes, max_per_hour, enabled)
             VALUES (?, ?::int[], ?::text[], ?, ?, ?, ?::boolean) RETURNING id', $values
        );
        Audit::log($user, $request, 'ntfy.rule.create', $values[0]);
        return ['id' => $id];
    }

    public function updateRule(Request $request, array $user): array
    {
        $values = $this->ruleInput($request);
        $n = Db::exec(
            'UPDATE ntfy_rules SET name = ?, board_ids = ?::int[], kinds = ?::text[], mode = ?, interval_minutes = ?, max_per_hour = ?,
                    enabled = ?::boolean, last_run_at = NULL, pending_job = NULL WHERE id = ?',
            [...$values, $request->arg('id')]
        );
        if (!$n) {
            throw ApiError::notFound();
        }
        Audit::log($user, $request, 'ntfy.rule.update', $values[0]);
        return ['ok' => true];
    }

    public function deleteRule(Request $request, array $user): array
    {
        Db::exec('DELETE FROM ntfy_rules WHERE id = ?', [$request->arg('id')]);
        Audit::log($user, $request, 'ntfy.rule.delete', (string) $request->arg('id'));
        return ['ok' => true];
    }

    /** Bildirim geçmişi: ids=1,2,3 ya da all=1 (bu ekran) / name=<kural adı> (Disk kullanımı). */
    public function deleteMessages(Request $request, array $user): array
    {
        if ($request->query('all') === '1') {
            $scope = 'tümü';
            $deleted = Db::exec('DELETE FROM ntfy_messages');
        } elseif (($name = (string) $request->query('name', '')) !== '') {
            $scope = $name;
            $deleted = Db::exec('DELETE FROM ntfy_messages WHERE rule_name = ?', [$name]);
        } else {
            $ids = array_map('intval', array_filter(explode(',', (string) $request->query('ids', ''))));
            if (!$ids) {
                throw ApiError::badRequest('Silinecek kayıt seçilmedi.');
            }
            $scope = count($ids) . ' kayıt';
            $deleted = Db::exec('DELETE FROM ntfy_messages WHERE id = ANY(?::bigint[])', ['{' . implode(',', $ids) . '}']);
        }
        Audit::log($user, $request, 'ntfy.messages.delete', $scope, ['deleted' => $deleted]);
        return ['ok' => true, 'deleted' => $deleted];
    }

    /** Disk kullanımı: kural başına bildirim sayısı. */
    public function stats(): array
    {
        $bytes = Storage::relationBytes('ntfy_messages');
        $rows = Db::all(
            "SELECT rule_name AS name, count(*) AS n, (extract(epoch FROM min(sent_at)) * 1000)::bigint AS first,
                    (extract(epoch FROM max(sent_at)) * 1000)::bigint AS last
             FROM ntfy_messages GROUP BY rule_name ORDER BY n DESC"
        );
        $total = array_sum(array_column($rows, 'n'));
        foreach ($rows as &$row) {
            $row['est_bytes'] = Storage::share($bytes, (int) $row['n'], $total);
        }
        unset($row);
        return [
            'boards' => $rows,
            'total' => ['n' => $total, 'bytes' => $bytes,
                'first' => $rows ? min(array_column($rows, 'first')) : null,
                'last' => $rows ? max(array_column($rows, 'last')) : null],
            'disk' => Storage::diskSpace(),
        ];
    }
}
