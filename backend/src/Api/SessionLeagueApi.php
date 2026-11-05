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

use Ankamon\Core\Db;
use Ankamon\Core\Request;
use Ankamon\Core\Settings;
use DateTimeImmutable;

/**
 * Oturumlar ▸ Şampiyonlar Ligi: tahtalarda en uzun süre oturum açık tutan kullanıcılar — bugün, bu hafta, bu ay,
 * bu dönem ve bu eğitim-öğretim yılı için ayrı sıralama. Kaynak board_sessions DEĞİL, worker'ın ondan türettiği
 * session_league_parts (oturumun gün parçaları; bkz. db/migrations/039_session_league.sql, worker
 * tasks/session_league.py): oturum kayıtları ya da loglar silinse de sıralama korunur. Günler veritabanının saat
 * diliminde (TZ) yerel gündür; dönem/yıl sınırları Settings 'school_calendar'dan.
 */
final class SessionLeagueApi
{
    /** Sıralamaya girmeyen hesaplar: tahtanın yönetici ve sistem hesabı (öğretmen kullanımı değil). */
    private const LEAGUE_EXCLUDED_USERS = ['etapadmin', 'root'];

    public function index(Request $request): array
    {
        $limit = $request->queryInt('limit', 10, 1, 50);
        $today = new DateTimeImmutable((string) Db::value('SELECT current_date::text'));
        $periods = [];
        foreach (self::leaguePeriods($today, Settings::get('school_calendar')) as $period) {
            $periods[] = $period + self::leagueStandings($period['from'], $period['to'], $limit);
        }
        return ['today' => $today->format('Y-m-d'), 'periods' => $periods];
    }

    /**
     * Dönemler: [key, title, from, to) — to hariç, "YYYY-AA-GG". Hafta pazartesi başlar. Eğitim-öğretim yılı
     * term1_start'ta başlar; bugün term2_start'tan önceyse 1. dönem, sonraysa 2. dönem (term2_end'den sonraki yaz
     * tatilinde de biten 2. dönem gösterilir, "bitti" işaretiyle).
     */
    private static function leaguePeriods(DateTimeImmutable $today, array $calendar): array
    {
        $md = fn(string $key, string $fallback) => preg_match('/^\d{2}-\d{2}$/', (string) ($calendar[$key] ?? ''))
            ? $calendar[$key] : $fallback;
        [$t1, $t2, $t2end] = [$md('term1_start', '09-01'), $md('term2_start', '02-01'), $md('term2_end', '06-30')];
        $y = (int) $today->format('Y');
        $startYear = $today->format('m-d') >= $t1 ? $y : $y - 1;
        $yearFrom = new DateTimeImmutable("$startYear-$t1");
        $yearTo = new DateTimeImmutable(($startYear + 1) . "-$t1");
        $term2From = new DateTimeImmutable(($startYear + 1) . "-$t2");
        $term2To = (new DateTimeImmutable(($startYear + 1) . "-$t2end"))->modify('+1 day');
        $schoolYear = "$startYear-" . ($startYear + 1);
        if ($today < $term2From) {
            $term = ['title' => '1. dönem', 'from' => $yearFrom, 'to' => $term2From, 'ended' => false];
        } else {
            $term = ['title' => '2. dönem', 'from' => $term2From, 'to' => $term2To, 'ended' => $today >= $term2To];
        }
        $monday = $today->modify('-' . ((int) $today->format('N') - 1) . ' days');
        $monthFrom = $today->modify('first day of this month');
        $list = [
            ['key' => 'day', 'title' => 'Günün şampiyonu', 'label' => 'Bugün', 'from' => $today, 'to' => $today->modify('+1 day')],
            ['key' => 'week', 'title' => 'Haftanın şampiyonu', 'label' => 'Bu hafta', 'from' => $monday, 'to' => $monday->modify('+7 days')],
            ['key' => 'month', 'title' => 'Ayın şampiyonu', 'label' => 'Bu ay', 'from' => $monthFrom, 'to' => $monthFrom->modify('+1 month')],
            ['key' => 'term', 'title' => 'Dönemin şampiyonu', 'label' => "$schoolYear {$term['title']}" . ($term['ended'] ? ' (bitti)' : ''),
                'from' => $term['from'], 'to' => $term['to']],
            ['key' => 'year', 'title' => 'Yılın şampiyonu', 'label' => "$schoolYear eğitim-öğretim yılı", 'from' => $yearFrom, 'to' => $yearTo],
        ];
        foreach ($list as &$period) {
            $period['from'] = $period['from']->format('Y-m-d');
            $period['to'] = $period['to']->format('Y-m-d');
        }
        unset($period);
        return $list;
    }

    /**
     * [from, to) aralığında kullanıcı başına toplam açık oturum süresi (çoktan aza, ilk $limit), etkin gün, oturum ve
     * tahta sayısı, en çok kullandığı tahta (takma adıyla); ayrıca katılımcı sayısı ve toplam süre.
     */
    private static function leagueStandings(string $from, string $to, int $limit): array
    {
        $excluded = Db::textArray(self::LEAGUE_EXCLUDED_USERS);
        $rows = Db::all(
            "WITH parts AS (
                 SELECT p.* FROM session_league_parts p
                 WHERE p.day >= ?::date AND p.day < ?::date AND lower(p.username) <> ALL(?::text[])
             ), totals AS (
                 SELECT username, sum(seconds)::bigint AS seconds, count(DISTINCT day) AS days,
                        count(DISTINCT session_id) AS sessions, count(DISTINCT host) AS boards
                 FROM parts GROUP BY username HAVING sum(seconds) > 0
             ), ranked AS (
                 SELECT *, count(*) OVER () AS participants, sum(seconds) OVER ()::bigint AS total_seconds
                 FROM totals ORDER BY seconds DESC, username LIMIT ?
             ), top_board AS (
                 SELECT DISTINCT ON (p.username) p.username, COALESCE(NULLIF(b.label, ''), p.host) AS board
                 FROM parts p LEFT JOIN boards b ON b.id = p.board_id
                 WHERE p.username IN (SELECT username FROM ranked)
                 GROUP BY p.username, p.host, b.label ORDER BY p.username, sum(p.seconds) DESC
             )
             SELECT r.username, n.full_name, r.seconds, r.days, r.sessions, r.boards, t.board,
                    r.participants, r.total_seconds
             FROM ranked r
             LEFT JOIN session_league_names n ON n.username = r.username
             LEFT JOIN top_board t ON t.username = r.username
             ORDER BY r.seconds DESC, r.username",
            [$from, $to, $excluded, $limit]
        );
        $first = $rows[0] ?? null;
        return [
            'participants' => $first ? (int) $first['participants'] : 0,
            'total_seconds' => $first ? (int) $first['total_seconds'] : 0,
            'leaders' => array_map(fn(array $r) => [
                'username' => $r['username'],
                'full_name' => $r['full_name'],
                'seconds' => (int) $r['seconds'],
                'days' => (int) $r['days'],
                'sessions' => (int) $r['sessions'],
                'boards' => (int) $r['boards'],
                'board' => $r['board'],
            ], $rows),
        ];
    }
}
