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
 * Oturumlar ▸ Teneffüs Ligi: ders aralarında (teneffüsler ve öğle arası — Ayarlar ▸ Ders saatleri'ndeki ardışık dersler
 * arası) en çok açık kalan tahtalar; günün, haftanın, ayın, dönemin ve eğitim-öğretim yılının sıralaması (dönem sınırları
 * Şampiyonlar Ligi ile aynı, bkz. SessionLeagueApi::leaguePeriods). Açık kalınan süre oturum AÇIKKEN ve oturum KAPALIYKEN
 * (giriş ekranında) diye ikiye ayrılır; sıralama ölçütü seçilebilir. Veri worker'ın doldurduğu break_league_days'ten
 * (bkz. worker/ankamon/tasks/break_league.py, db/migrations/041_break_league.sql). Lig dışı bırakılan tahtalar
 * (league_exclusions, league 'break' — bkz. LeagueExclusionsApi) varsayılan olarak sayılmaz; with_excluded=1 ile
 * işaretli (excluded: true) katılır.
 *
 * by=users: aynı üç ölçü kullanıcı adı bazında (break_league_user_days, göç 044): oturum açıkken = kullanıcının kendi
 * oturumu; oturum kapalıyken = tahtayı o açılışta giriş ekranında açık bırakan, yani parçadan önce oturumu son kapanan
 * kullanıcıya yazılan süre (açılıştan beri kimse oturum açmadıysa kimseye yazılmaz). Şampiyonlar Ligi'ndeki gibi
 * etapadmin/root sayılmaz; lig dışı kullanıcılar (league 'break', kind 'user') tahta dışlamasından bağımsızdır.
 */
final class BreakLeagueApi
{
    /** sort parametresi → sıralanan sütun. */
    private const BREAK_LEAGUE_SORTS = [
        'total' => 'on_seconds',
        'session' => 'session_seconds',
        'nosession' => 'idle_seconds',
    ];

    public function index(Request $request): array
    {
        $limit = $request->queryInt('limit', 10, 1, 50);
        $sort = (string) $request->query('sort', 'total');
        $column = self::BREAK_LEAGUE_SORTS[$sort] ?? self::BREAK_LEAGUE_SORTS['total'];
        $today = new DateTimeImmutable((string) Db::value('SELECT current_date::text'));
        $lessons = Settings::get('lesson_times');
        $withOut = $request->query('with_excluded') === '1';
        $by = $request->query('by') === 'users' ? 'users' : 'boards';
        $leagueOut = LeagueExclusionsApi::leagueExcludedValues('break', $by === 'users' ? 'user' : 'board');
        $periods = [];
        foreach (SessionLeagueApi::leaguePeriods($today, Settings::get('school_calendar')) as $period) {
            $period['title'] = str_replace('şampiyonu', 'teneffüs şampiyonu', $period['title']);
            $periods[] = $period + ($by === 'users'
                ? self::breakUserStandings($period['from'], $period['to'], $column, $limit, $leagueOut, $withOut)
                : self::breakStandings($period['from'], $period['to'], $column, $limit, $leagueOut, $withOut));
        }
        return [
            'today' => $today->format('Y-m-d'),
            'by' => $by,
            'sort' => isset(self::BREAK_LEAGUE_SORTS[$sort]) ? $sort : 'total',
            'breaks' => self::breakWindows($lessons),
            'boards' => (int) Db::value('SELECT count(*) FROM boards'),
            'with_excluded' => $withOut,
            'excluded' => $leagueOut,
            'periods' => $periods,
        ];
    }

    /** Ders saatlerinden teneffüs pencereleri ["10:35–10:45", …] (yalnız gösterim; hesap worker'da). */
    private static function breakWindows(array $lessons): array
    {
        $list = array_values(array_filter((array) ($lessons['lessons'] ?? []), fn($l) => isset($l['start'], $l['end'])));
        usort($list, fn($a, $b) => strcmp($a['start'], $b['start']));
        $windows = [];
        for ($i = 1; $i < count($list); $i++) {
            if ($list[$i]['start'] > $list[$i - 1]['end']) {
                $windows[] = $list[$i - 1]['end'] . '–' . $list[$i]['start'];
            }
        }
        return $windows;
    }

    /**
     * [from, to) aralığında tahta başına teneffüste açık kalınan süre (oturum açık/kapalı ayrımıyla), seçilen ölçüte göre
     * çoktan aza ilk $limit; teneffüs süresine oranı, gün sayısı. Ayrıca katılan tahta sayısı, toplamlar ve dönemde
     * süresi olan lig dışı tahta sayısı (excluded_count). Lig dışılar $withOut değilse ne sıralamaya ne toplamlara girer.
     */
    private static function breakStandings(string $from, string $to, string $column, int $limit, array $leagueOut, bool $withOut): array
    {
        $out = Db::textArray($leagueOut);
        $shown = $withOut ? 'true' : 'false';
        $rows = Db::all(
            "WITH days AS (
                 SELECT host, max(board_id) AS board_id, sum(on_seconds)::bigint AS on_seconds,
                        sum(session_seconds)::bigint AS session_seconds,
                        sum(on_seconds - session_seconds)::bigint AS idle_seconds,
                        sum(break_seconds)::bigint AS break_seconds, count(*) AS days
                 FROM break_league_days WHERE day >= ?::date AND day < ?::date AND (?::boolean OR host <> ALL(?::text[]))
                 GROUP BY host HAVING sum(on_seconds) > 0
             ), ranked AS (
                 SELECT * FROM days WHERE $column > 0 ORDER BY $column DESC, on_seconds DESC, host LIMIT ?
             )
             SELECT r.*, COALESCE(NULLIF(b.label, ''), r.host) AS board, r.host = ANY(?::text[]) AS excluded
             FROM ranked r LEFT JOIN boards b ON b.id = r.board_id
             ORDER BY r.$column DESC, r.on_seconds DESC, r.host",
            [$from, $to, $shown, $out, $limit, $out]
        );
        $all = Db::one(
            'SELECT count(DISTINCT host) AS boards, COALESCE(sum(on_seconds), 0)::bigint AS on_seconds,
                    COALESCE(sum(session_seconds), 0)::bigint AS session_seconds
             FROM break_league_days WHERE day >= ?::date AND day < ?::date AND on_seconds > 0
               AND (?::boolean OR host <> ALL(?::text[]))',
            [$from, $to, $shown, $out]
        ) ?: [];
        $hidden = $leagueOut ? (int) Db::value(
            'SELECT count(DISTINCT host) FROM break_league_days
             WHERE day >= ?::date AND day < ?::date AND on_seconds > 0 AND host = ANY(?::text[])',
            [$from, $to, $out]
        ) : 0;
        return [
            'participants' => (int) ($all['boards'] ?? 0),
            'total_seconds' => (int) ($all['on_seconds'] ?? 0),
            'total_session_seconds' => (int) ($all['session_seconds'] ?? 0),
            'excluded_count' => $hidden,
            'leaders' => array_map(fn(array $r) => [
                'host' => $r['host'],
                'board' => $r['board'],
                'seconds' => (int) $r['on_seconds'],
                'session_seconds' => (int) $r['session_seconds'],
                'idle_seconds' => (int) $r['idle_seconds'],
                'break_seconds' => (int) $r['break_seconds'],
                'days' => (int) $r['days'],
                'excluded' => (bool) $r['excluded'],
            ], $rows),
        ];
    }

    /**
     * [from, to) aralığında kullanıcı başına teneffüs süresi (by=users): oturum açıkken (session_seconds), oturum
     * kapalıyken açık bıraktığı (idle_seconds) ve toplamı (on_seconds), seçilen ölçüte göre çoktan aza ilk $limit; gün ve
     * tahta sayısı, en çok süre biriktirdiği tahta (takma adıyla). Toplamlar ve lig dışı sayısı breakStandings gibi.
     * etapadmin/root hiç sayılmaz (SessionLeagueApi::LEAGUE_EXCLUDED_USERS).
     */
    private static function breakUserStandings(string $from, string $to, string $column, int $limit, array $leagueOut, bool $withOut): array
    {
        $out = Db::textArray($leagueOut);
        $system = Db::textArray(SessionLeagueApi::LEAGUE_EXCLUDED_USERS);
        $shown = $withOut ? 'true' : 'false';
        $base = 'SELECT * FROM break_league_user_days WHERE day >= ?::date AND day < ?::date
                   AND lower(username) <> ALL(?::text[])';
        $rows = Db::all(
            "WITH parts AS ($base AND (?::boolean OR lower(username) <> ALL(?::text[]))),
             totals AS (
                 SELECT username, sum(session_seconds + idle_seconds)::bigint AS on_seconds,
                        sum(session_seconds)::bigint AS session_seconds, sum(idle_seconds)::bigint AS idle_seconds,
                        count(DISTINCT day) AS days, count(DISTINCT host) AS boards
                 FROM parts GROUP BY username HAVING sum(session_seconds + idle_seconds) > 0
             ), ranked AS (
                 SELECT * FROM totals WHERE $column > 0 ORDER BY $column DESC, on_seconds DESC, username LIMIT ?
             ), top AS (
                 SELECT DISTINCT ON (p.username) p.username AS k, COALESCE(NULLIF(b.label, ''), p.host) AS top
                 FROM parts p LEFT JOIN boards b ON b.id = p.board_id
                 WHERE p.username IN (SELECT username FROM ranked)
                 GROUP BY p.username, p.host, b.label ORDER BY p.username, sum(p.session_seconds + p.idle_seconds) DESC
             )
             SELECT r.*, n.full_name, t.top AS board, lower(r.username) = ANY(?::text[]) AS excluded
             FROM ranked r LEFT JOIN session_league_names n ON n.username = r.username LEFT JOIN top t ON t.k = r.username
             ORDER BY r.$column DESC, r.on_seconds DESC, r.username",
            [$from, $to, $system, $shown, $out, $limit, $out]
        );
        $all = Db::one(
            "SELECT count(DISTINCT username) AS users, COALESCE(sum(session_seconds + idle_seconds), 0)::bigint AS on_seconds,
                    COALESCE(sum(session_seconds), 0)::bigint AS session_seconds
             FROM ($base AND session_seconds + idle_seconds > 0 AND (?::boolean OR lower(username) <> ALL(?::text[]))) p",
            [$from, $to, $system, $shown, $out]
        ) ?: [];
        $hidden = $leagueOut ? (int) Db::value(
            "SELECT count(DISTINCT lower(username)) FROM ($base AND session_seconds + idle_seconds > 0
               AND lower(username) = ANY(?::text[])) p",
            [$from, $to, $system, $out]
        ) : 0;
        // Kimseye yazılamayan oturumsuz süre (tahta açıldığından beri kimse oturum açmamış): tahta bazındaki toplamdan
        // kullanıcılara (etapadmin/root dahil) yazılan kısım düşülür; lig dışılardan bağımsız, yalnız bilgi.
        $unassigned = (int) Db::value(
            'SELECT GREATEST(0, (SELECT COALESCE(sum(on_seconds - session_seconds), 0) FROM break_league_days
                                 WHERE day >= ?::date AND day < ?::date)
                              - (SELECT COALESCE(sum(idle_seconds), 0) FROM break_league_user_days
                                 WHERE day >= ?::date AND day < ?::date))::bigint',
            [$from, $to, $from, $to]
        );
        return [
            'participants' => (int) ($all['users'] ?? 0),
            'unassigned_idle_seconds' => $unassigned,
            'total_seconds' => (int) ($all['on_seconds'] ?? 0),
            'total_session_seconds' => (int) ($all['session_seconds'] ?? 0),
            'excluded_count' => $hidden,
            'leaders' => array_map(fn(array $r) => [
                'username' => $r['username'],
                'full_name' => $r['full_name'],
                'board' => $r['board'],
                'seconds' => (int) $r['on_seconds'],
                'session_seconds' => (int) $r['session_seconds'],
                'idle_seconds' => (int) $r['idle_seconds'],
                'days' => (int) $r['days'],
                'boards' => (int) $r['boards'],
                'excluded' => (bool) $r['excluded'],
            ], $rows),
        ];
    }
}
