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

/**
 * Wi-Fi Monitör güvenilir vericilerinin fiziksel konumu (kullanıcı isteği 2026-11-11; göç 050).
 *
 * index: güvenilir listesindeki adreslerin (erişim noktası / Wi-Fi cihazı — MAC'li kayıtlar) ve aynı fiziksel cihazın diğer radyo
 * adreslerinin (ilk 5 bayt aynı — ör. Edgecore 2,4 GHz …:B0 + 5 GHz …:A0) sensör × bant sinyal istatistikleri (son `days` gün;
 * worker screen/wifimon_signal_log.py yazar), elle atanmış konumlar ve sensör listesi (açılır liste: kod adı ya da
 * bilgisayar adı / kablolu MAC). Öneri ve gruplama arayüzde (ui.boards.WifimonLocation).
 * save: adreslere konum (yanındaki sensör) yazar ya da siler; sensörün kablolu MAC'i ve adı da saklanır.
 * Yetki "screen" (Wi-Fi Monitör'ü açabilen herkes; bkz. routes.php).
 */
final class WifimonLocationsApi
{
    private const MAX_ITEMS = 200;

    public function index(Request $request): array
    {
        $days = $request->queryInt('days', 30, 1, 90);
        $stats = Db::all(
            "WITH pre AS (SELECT DISTINCT left(upper(value), 14) AS p FROM wifimon_fixed_emitters WHERE kind IN ('bssid', 'probe'))
             SELECT s.addr, s.board_id, s.band, sum(s.n)::int AS n, sum(s.n_est)::int AS n_est,
                    round((sum(s.sum_dbm) / sum(s.n))::numeric, 1)::float8 AS avg,
                    round(sqrt(greatest(sum(s.sum_sq_dbm) / sum(s.n) - (sum(s.sum_dbm) / sum(s.n)) ^ 2, 0))::numeric, 1)::float8 AS sd,
                    min(s.min_dbm)::float8 AS min, max(s.max_dbm)::float8 AS max,
                    (array_agg(s.last_dbm ORDER BY s.last_at DESC))[1]::float8 AS last,
                    (array_agg(s.last_chan ORDER BY s.last_at DESC))[1] AS chan,
                    count(DISTINCT s.day)::int AS days,
                    (extract(epoch FROM max(s.last_at)) * 1000)::bigint AS last_ts
             FROM wifimon_signal_stats s JOIN pre ON left(s.addr, 14) = pre.p
             WHERE s.day >= current_date - ?::int AND s.n > 0
             GROUP BY s.addr, s.board_id, s.band",
            [$days]
        );
        foreach ($stats as &$row) {
            foreach (['board_id', 'n', 'n_est', 'days', 'last_ts'] as $key) {
                $row[$key] = (int) $row[$key];
            }
            foreach (['avg', 'sd', 'min', 'max', 'last'] as $key) {
                $row[$key] = $row[$key] === null ? null : (float) $row[$key];
            }
        }
        unset($row);
        $locations = Db::all(
            "SELECT l.addr, l.board_id, l.sensor_mac::text AS sensor_mac, l.sensor_name, l.note, l.set_by,
                    (extract(epoch FROM l.set_at) * 1000)::bigint AS set_ts
             FROM wifimon_emitter_locations l ORDER BY l.addr"
        );
        foreach ($locations as &$row) {
            $row['board_id'] = $row['board_id'] === null ? null : (int) $row['board_id'];
            $row['set_ts'] = (int) $row['set_ts'];
        }
        unset($row);
        $sensors = Db::all("SELECT id, label, hostname, mac::text AS mac, host(ip) AS ip FROM boards ORDER BY id");
        foreach ($sensors as &$row) {
            $row['id'] = (int) $row['id'];
        }
        unset($row);
        return ['days' => $days, 'stats' => $stats, 'locations' => $locations, 'sensors' => $sensors];
    }

    /** addrs [..], board_id (null = konumu sil), note? — aynı fiziksel cihazın adresleri birlikte gönderilir. */
    public function save(Request $request, array $user): array
    {
        $addrs = array_values(array_unique(array_map(
            static fn($a) => strtoupper(trim((string) $a)), (array) $request->input('addrs', []))));
        if (!$addrs) {
            throw ApiError::badRequest('Konumu kaydedilecek adres seçilmedi.');
        }
        if (count($addrs) > self::MAX_ITEMS) {
            throw ApiError::badRequest('Tek seferde en fazla ' . self::MAX_ITEMS . ' adres.');
        }
        foreach ($addrs as $addr) {
            if (!preg_match('/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/', $addr)) {
                throw ApiError::badRequest('Geçersiz adres: ' . $addr);
            }
        }
        $raw = $request->input('board_id');
        $boardId = $raw === null || $raw === '' ? null : (int) $raw;
        $note = mb_substr(trim((string) $request->input('note', '')), 0, 200);
        $placeholders = implode(',', array_fill(0, count($addrs), '?'));
        if ($boardId === null) {
            $changed = Db::exec("DELETE FROM wifimon_emitter_locations WHERE addr IN ($placeholders)", $addrs);
        } else {
            $board = Db::one(
                "SELECT id, mac::text AS mac, coalesce(nullif(label, ''), hostname, host(ip), '#' || id) AS name FROM boards WHERE id = ?",
                [$boardId]
            );
            if (!$board) {
                throw ApiError::badRequest('Sensör (tahta) bulunamadı.');
            }
            $changed = Db::transaction(static function () use ($addrs, $board, $note, $user): int {
                $count = 0;
                foreach ($addrs as $addr) {
                    $count += Db::exec(
                        'INSERT INTO wifimon_emitter_locations (addr, board_id, sensor_mac, sensor_name, note, set_by, set_at)
                         VALUES (?, ?, ?::macaddr, ?, ?, ?, now())
                         ON CONFLICT (addr) DO UPDATE SET board_id = EXCLUDED.board_id, sensor_mac = EXCLUDED.sensor_mac,
                           sensor_name = EXCLUDED.sensor_name, note = EXCLUDED.note, set_by = EXCLUDED.set_by, set_at = now()',
                        [$addr, (int) $board['id'], $board['mac'], (string) $board['name'], $note, (string) ($user['username'] ?? '—')]
                    );
                }
                return $count;
            });
        }
        Audit::log($user, $request, 'wifimon.location.save', '', ['addrs' => $addrs, 'board_id' => $boardId, 'changed' => $changed]);
        return ['ok' => true, 'changed' => $changed];
    }
}
