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
 * Oturumlar ▸ Şampiyonlar Ligi: tahtalarda en uzun süre oturum açık tutan kullanıcılar (by=users) ya da en uzun süre
 * oturumlu kalan tahtalar (by=boards) — bugün, bu hafta, bu ay, bu dönem ve bu eğitim-öğretim yılı için ayrı sıralama.
 * Kaynak board_sessions DEĞİL, worker'ın ondan türettiği session_league_parts (oturumun gün parçaları; bkz.
 * db/migrations/039_session_league.sql, worker tasks/session_league.py): oturum kayıtları ya da loglar silinse de
 * sıralama korunur. Günler veritabanının saat diliminde (TZ) yerel gündür; dönem/yıl sınırları Settings
 * 'school_calendar'dan. Lig dışı bırakılan kullanıcı/tahtalar (league_exclusions, league 'session' — bkz.
 * LeagueExclusionsApi) varsayılan olarak sayılmaz; with_excluded=1 ile işaretli (excluded: true) katılır.
 */
final class SessionLeagueApi
{
    /** Sıralamaya girmeyen hesaplar: tahtanın yönetici ve sistem hesabı (öğretmen kullanımı değil). Tahta
     * sıralamasında da bu hesapların oturumları sayılmaz. */
    public const LEAGUE_EXCLUDED_USERS = ['etapadmin', 'root'];

    public function index(Request $request): array
    {
        $limit = $request->queryInt('limit', 10, 1, 50);
        $by = $request->query('by') === 'boards' ? 'boards' : 'users';
        $withOut = $request->query('with_excluded') === '1';
        $leagueOut = LeagueExclusionsApi::leagueExcludedValues('session', $by === 'boards' ? 'board' : 'user');
        $today = new DateTimeImmutable((string) Db::value('SELECT current_date::text'));
        $periods = [];
        foreach (self::leaguePeriods($today, Settings::get('school_calendar')) as $period) {
            if ($by === 'boards') {
                $period['title'] = str_replace('şampiyonu', 'şampiyon tahtası', $period['title']);
            }
            $periods[] = $period + self::leagueStandings($by, $period['from'], $period['to'], $limit, $leagueOut, $withOut);
        }
        return ['today' => $today->format('Y-m-d'), 'by' => $by, 'with_excluded' => $withOut,
            'excluded' => $leagueOut, 'periods' => $periods];
    }

    /**
     * Dönemler: [key, title, from, to) — to hariç, "YYYY-AA-GG". Hafta pazartesi başlar. Eğitim-öğretim yılı
     * term1_start'ta başlar; bugün term2_start'tan önceyse 1. dönem, sonraysa 2. dönem (term2_end'den sonraki yaz
     * tatilinde de biten 2. dönem gösterilir, "bitti" işaretiyle).
     */
    public static function leaguePeriods(DateTimeImmutable $today, array $calendar): array
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
     * [from, to) aralığında kullanıcı (by=users) ya da tahta (by=boards) başına toplam açık oturum süresi (çoktan aza,
     * ilk $limit), etkin gün, oturum sayısı; kullanıcıda tahta sayısı ve en çok kullandığı tahta (takma adıyla),
     * tahtada kullanıcı sayısı ve en çok kullanan kullanıcı. Ayrıca katılımcı sayısı, toplam süre ve dönemde süresi
     * olan lig dışı sayısı (excluded_count). Lig dışılar $withOut değilse ne sıralamaya ne toplamlara girer.
     */
    private static function leagueStandings(string $by, string $from, string $to, int $limit, array $leagueOut, bool $withOut): array
    {
        $users = $by === 'users';
        // Gruplama anahtarı ve "en çok" eşi: kullanıcının en çok kullandığı tahta / tahtayı en çok kullanan kullanıcı.
        $key = $users ? 'username' : 'host';
        $outMatch = $users ? 'lower(username)' : 'host';
        $count = $users ? 'count(DISTINCT host) AS boards' : 'count(DISTINCT username) AS users, max(board_id) AS board_id';
        $top = $users
            ? "SELECT DISTINCT ON (p.username) p.username AS k, COALESCE(NULLIF(b.label, ''), p.host) AS top
               FROM parts p LEFT JOIN boards b ON b.id = p.board_id
               WHERE p.username IN (SELECT username FROM ranked)
               GROUP BY p.username, p.host, b.label ORDER BY p.username, sum(p.seconds) DESC"
            : "SELECT DISTINCT ON (p.host) p.host AS k, COALESCE(NULLIF(n.full_name, ''), p.username) AS top
               FROM parts p LEFT JOIN session_league_names n ON n.username = p.username
               WHERE p.host IN (SELECT host FROM ranked)
               GROUP BY p.host, p.username, n.full_name ORDER BY p.host, sum(p.seconds) DESC";
        $select = $users
            ? 'SELECT r.*, n.full_name, t.top AS board FROM ranked r
               LEFT JOIN session_league_names n ON n.username = r.username LEFT JOIN top t ON t.k = r.username'
            : "SELECT r.*, COALESCE(NULLIF(b.label, ''), r.host) AS board, t.top AS top_user FROM ranked r
               LEFT JOIN boards b ON b.id = r.board_id LEFT JOIN top t ON t.k = r.host";
        $rows = Db::all(
            "WITH parts AS (
                 SELECT p.* FROM session_league_parts p
                 WHERE p.day >= ?::date AND p.day < ?::date AND lower(p.username) <> ALL(?::text[])
             ), totals AS (
                 SELECT $key, sum(seconds)::bigint AS seconds, count(DISTINCT day) AS days,
                        count(DISTINCT session_id) AS sessions, $count, $outMatch = ANY(?::text[]) AS excluded
                 FROM parts GROUP BY $key HAVING sum(seconds) > 0
             ), shown AS (
                 SELECT * FROM totals WHERE ?::boolean OR NOT excluded
             ), ranked AS (
                 SELECT *, count(*) OVER () AS participants, sum(seconds) OVER ()::bigint AS total_seconds
                 FROM shown ORDER BY seconds DESC, $key LIMIT ?
             ), top AS ($top)
             $select
             ORDER BY r.seconds DESC, r.$key",
            [$from, $to, Db::textArray(self::LEAGUE_EXCLUDED_USERS), Db::textArray($leagueOut), $withOut ? 'true' : 'false', $limit]
        );
        $hidden = $leagueOut ? (int) Db::value(
            "SELECT count(DISTINCT $outMatch) FROM session_league_parts
             WHERE day >= ?::date AND day < ?::date AND lower(username) <> ALL(?::text[]) AND $outMatch = ANY(?::text[])
               AND seconds > 0",
            [$from, $to, Db::textArray(self::LEAGUE_EXCLUDED_USERS), Db::textArray($leagueOut)]
        ) : 0;
        $first = $rows[0] ?? null;
        return [
            'participants' => $first ? (int) $first['participants'] : 0,
            'total_seconds' => $first ? (int) $first['total_seconds'] : 0,
            'excluded_count' => $hidden,
            'leaders' => array_map(fn(array $r) => $users ? [
                'username' => $r['username'],
                'full_name' => $r['full_name'],
                'seconds' => (int) $r['seconds'],
                'days' => (int) $r['days'],
                'sessions' => (int) $r['sessions'],
                'boards' => (int) $r['boards'],
                'board' => $r['board'],
                'excluded' => (bool) $r['excluded'],
            ] : [
                'host' => $r['host'],
                'board' => $r['board'],
                'seconds' => (int) $r['seconds'],
                'days' => (int) $r['days'],
                'sessions' => (int) $r['sessions'],
                'users' => (int) $r['users'],
                'top_user' => $r['top_user'],
                'excluded' => (bool) $r['excluded'],
            ], $rows),
        ];
    }
}
