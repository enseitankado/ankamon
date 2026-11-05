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
        $leagueOut = LeagueExclusionsApi::leagueExcludedValues('break', 'board');
        $periods = [];
        foreach (SessionLeagueApi::leaguePeriods($today, Settings::get('school_calendar')) as $period) {
            $period['title'] = str_replace('şampiyonu', 'teneffüs şampiyonu', $period['title']);
            $periods[] = $period + self::breakStandings($period['from'], $period['to'], $column, $limit, $leagueOut, $withOut);
        }
        return [
            'today' => $today->format('Y-m-d'),
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
}
