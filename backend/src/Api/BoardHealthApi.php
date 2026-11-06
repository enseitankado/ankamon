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
use Ankamon\Core\Auth;
use Ankamon\Core\Db;
use Ankamon\Core\Request;

/**
 * Tahta sağlığı ▸ Durum: iki yoldan gelen bulgular tek biçimde (bkz. frontend ui.health.Status; GET /api/board-health).
 * (Konteynerin kendi sağlık denetimi /api/health ayrıdır: HealthApi.)
 *
 *   path "watch" — Sürekli izleme: worker'ın anomali kuralları; tahtaya bağlanmadan, tahtanın gönderdiği loglardan,
 *                  Ankamon'un okuduğu ölçümlerden ve daha önce toplanmış verilerden birkaç dakikada bir çıkarılır
 *                  (anomalies tablosu, yalnız SÜRENLER).
 *   path "ssh"   — SSH denetimi: Ankamon tahtaya SSH ile girip ölçer (sorun tespiti, "diagnose" görevi); haftalık
 *                  otomatik ya da elle. Her tahtanın EN SON denetiminin dikkat/acil bulguları (DiagnoseApi::latest).
 *
 * Bulgu: {board_id, board, path, source, how, check, level (bad|warn|info), text, advice, since, run_id}.
 * Yetki: Sürekli izleme bulguları 'anomalies', SSH denetimi bulguları 'diagnose' ister; kullanıcı yalnız yetkili
 * olduğu yolu görür (paths alanı). İstek başına ölçüm yapılmaz: ikisi de önceden hesaplanmış kayıtlardır.
 */
final class BoardHealthApi
{
    /** Düzeylerin sırası (en kötüden): Bakım raporundakiyle aynı adlar (bkz. page.Diagnose LEVEL). */
    private const ORDER = ['bad' => 3, 'warn' => 2, 'info' => 1, 'ok' => 0];

    public function index(Request $request, array $user): array
    {
        $watch = Auth::can($user, 'anomalies');
        $ssh = Auth::can($user, 'diagnose');
        if (!$watch && !$ssh) {
            throw ApiError::forbidden();
        }
        $boards = Db::all(
            "SELECT id, COALESCE(NULLIF(label, ''), hostname, host(ip)) AS name, online, host(ip) AS ip
             FROM boards ORDER BY 2"
        );
        $findings = [];
        $kinds = AnomaliesApi::kinds();
        if ($watch) {
            $rows = Db::all(
                "SELECT a.id, a.kind, a.board_id, COALESCE(NULLIF(b.label, ''), NULLIF(a.board_name, ''), a.host) AS board,
                        extract(epoch FROM a.started_at)::bigint AS since, a.detail
                 FROM anomalies a LEFT JOIN boards b ON b.id = a.board_id
                 WHERE a.ended_at IS NULL ORDER BY a.started_at DESC"
            );
            foreach ($rows as $r) {
                $k = $kinds[$r['kind']] ?? [];
                $detail = json_decode((string) $r['detail'], true) ?: [];
                $findings[] = [
                    'board_id' => $r['board_id'] === null ? null : (int) $r['board_id'], 'board' => $r['board'],
                    'path' => 'watch', 'source' => $k['source'] ?? 'Log', 'how' => $k['source_detail'] ?? '',
                    'every' => $k['every'] ?? '', 'check' => $k['label'] ?? $r['kind'], 'kind' => $r['kind'],
                    'level' => $k['level'] ?? 'warn', 'text' => self::anomalyText($r['kind'], $detail),
                    'advice' => null, 'since' => (int) $r['since'], 'run_id' => null,
                    'origin' => $k['origin'] ?? null,
                ];
            }
        }
        $lastRuns = [];
        if ($ssh) {
            foreach ((new DiagnoseApi())->latest()['job']['targets'] as $t) {
                $bid = (int) $t['board_id'];
                $how = ($t['run_auto'] === true || $t['run_auto'] === 't' ? 'Haftalık otomatik SSH denetimi'
                    : 'Elle başlatılan SSH denetimi' . ($t['run_by'] ? ' (' . $t['run_by'] . ')' : ''));
                $lastRuns[$bid] = ['at' => $t['finished_at'] === null ? null : (int) $t['finished_at'],
                    'status' => $t['status'], 'run_id' => (int) $t['run_id'], 'how' => $how];
                $base = ['board_id' => $bid, 'board' => $t['board'], 'path' => 'ssh', 'source' => 'SSH denetimi',
                    'every' => 'Haftada bir + elle', 'kind' => null, 'since' => $lastRuns[$bid]['at'],
                    'run_id' => (int) $t['run_id'], 'origin' => null];
                if ($t['status'] !== 'ok') {
                    $findings[] = $base + ['how' => $how, 'check' => 'Denetlenemedi', 'level' => 'info',
                        'text' => trim((string) $t['output']) ?: 'Tahtaya SSH ile bağlanılamadı.', 'advice' => null];
                    continue;
                }
                $report = json_decode((string) $t['output'], true) ?: [];
                foreach ($report['checks'] ?? [] as $c) {
                    if (!in_array($c['level'] ?? '', ['warn', 'bad'], true)) {
                        continue;
                    }
                    $findings[] = $base + ['how' => $how, 'check' => trim(($c['group'] ?? '') . ' › ' . ($c['title'] ?? ''), ' ›'),
                        'level' => $c['level'], 'text' => (string) ($c['detail'] ?? ''), 'advice' => $c['advice'] ?? null];
                }
            }
        }
        usort($findings, static fn(array $a, array $b) =>
            [self::ORDER[$b['level']] ?? 0, $b['since'] ?? 0] <=> [self::ORDER[$a['level']] ?? 0, $a['since'] ?? 0]);
        return [
            'paths' => array_keys(array_filter(['watch' => $watch, 'ssh' => $ssh])),
            'boards' => array_map(static fn(array $b) => ['id' => (int) $b['id'], 'name' => $b['name'],
                'online' => (bool) $b['online'], 'ip' => $b['ip'], 'ssh' => $lastRuns[(int) $b['id']] ?? null], $boards),
            'findings' => $findings,
            // Denetimler sekmesi: sürekli izleme kurallarının adı, düzeyi, kaynağı ve sıklığı (bkz. AnomaliesApi::KINDS).
            'kinds' => $watch ? $kinds : (object) [],
            'generated_at' => time(),
        ];
    }

    /** Sürekli izleme bulgusunun metni: kural detail.text verir; eski iki kural için kısa metin (bkz. page.Anomalies.describe). */
    private static function anomalyText(string $kind, array $d): string
    {
        if (!empty($d['text'])) {
            return (string) $d['text'];
        }
        if ($kind === 'no_login') {
            return ($d['reason'] ?? '') === 'logout'
                ? 'Son oturum' . (!empty($d['user']) ? ' (' . $d['user'] . ')' : '') . ' kapandıktan sonra açık kaldı'
                : 'Açılıştan beri oturum açılmadı';
        }
        if ($kind === 'ntp_unsynced') {
            $parts = [];
            if (!empty($d['unsynced'])) {
                $parts[] = 'Saat NTP ile eşitlenmemiş';
            }
            if (isset($d['offset_max_s']) && abs((float) $d['offset_max_s']) > 1) {
                $parts[] = 'sunucuya göre en çok ' . round(abs((float) $d['offset_max_s'])) . ' sn sapma';
            }
            return $parts ? implode('; ', $parts) : 'Saat eşitlenmemiş';
        }
        return '';
    }
}
