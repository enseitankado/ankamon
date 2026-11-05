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
use DateTimeImmutable;

/**
 * Lig dışı bırakılanlar (league_exclusions — bkz. göç 042): görev gereği sürekli açık/oturumlu kalan tahtalar ve
 * kullanıcılar Şampiyonlar Ligi (league 'session': kullanıcı ve tahta sıralaması) ile Teneffüs Ligi'nden (league
 * 'break': tahta sıralaması) çıkarılır. Veri silinmez; lig API'leri listeyi leagueExcludedValues() ile okur, varsayılan
 * olarak saymaz. Listeleme 'logs', düzenleme 'leagues.exclude' yetkisi ister (bkz. routes.php).
 */
final class LeagueExclusionsApi
{
    /** Lig → dışlanabilen türler. */
    private const LEAGUE_EXCLUSION_KINDS = ['session' => ['user', 'board'], 'break' => ['board']];

    /** Ligin o türden dışlanan değerleri (kullanıcı adı küçük harf / tahta host adı). */
    public static function leagueExcludedValues(string $league, string $kind): array
    {
        return array_column(
            Db::all('SELECT value FROM league_exclusions WHERE league = ? AND kind = ? ORDER BY value', [$league, $kind]),
            'value'
        );
    }

    /**
     * Pencere için: ligin dışlananları ve seçilebilecek adaylar — bu eğitim-öğretim yılında ligde süresi olanlar (yıl
     * toplamı çoktan aza) ve Tahtalar'daki bütün tahtalar. Dışlanan ama adaylarda olmayan değer de listelenir.
     */
    public function index(Request $request): array
    {
        [$league, $kind] = self::validatedLeagueKind($request->query('league'), $request->query('kind'));
        $today = new DateTimeImmutable((string) Db::value('SELECT current_date::text'));
        $year = array_values(array_filter(
            SessionLeagueApi::leaguePeriods($today, Settings::get('school_calendar')),
            fn(array $p) => $p['key'] === 'year'
        ))[0];
        if ($kind === 'user') {
            $rows = Db::all(
                "SELECT p.username AS value, n.full_name AS label, sum(p.seconds)::bigint AS seconds
                 FROM session_league_parts p LEFT JOIN session_league_names n ON n.username = p.username
                 WHERE p.day >= ?::date AND p.day < ?::date AND lower(p.username) <> ALL(?::text[])
                 GROUP BY p.username, n.full_name ORDER BY seconds DESC, p.username",
                [$year['from'], $year['to'], Db::textArray(SessionLeagueApi::LEAGUE_EXCLUDED_USERS)]
            );
        } else {
            $source = $league === 'break'
                ? 'SELECT host, on_seconds AS seconds FROM break_league_days WHERE day >= ?::date AND day < ?::date'
                : "SELECT host, seconds FROM session_league_parts WHERE day >= ?::date AND day < ?::date
                     AND lower(username) <> ALL(?::text[])";
            $params = [$year['from'], $year['to']];
            if ($league === 'session') {
                $params[] = Db::textArray(SessionLeagueApi::LEAGUE_EXCLUDED_USERS);
            }
            $rows = Db::all(
                "WITH t AS (SELECT host, sum(seconds)::bigint AS seconds FROM ($source) s GROUP BY host),
                      hosts AS (SELECT host FROM t UNION SELECT hostname FROM boards WHERE hostname IS NOT NULL AND hostname <> '')
                 SELECT h.host AS value, NULLIF(b.label, '') AS label, COALESCE(t.seconds, 0)::bigint AS seconds
                 FROM hosts h LEFT JOIN t ON t.host = h.host
                 LEFT JOIN LATERAL (SELECT label FROM boards WHERE hostname = h.host ORDER BY id LIMIT 1) b ON true
                 ORDER BY seconds DESC, COALESCE(NULLIF(b.label, ''), h.host)",
                $params
            );
        }
        return [
            'league' => $league,
            'kind' => $kind,
            'year' => $year['label'],
            'excluded' => self::leagueExcludedValues($league, $kind),
            'candidates' => array_map(fn(array $r) => [
                'value' => $r['value'], 'label' => $r['label'], 'seconds' => (int) $r['seconds'],
            ], $rows),
        ];
    }

    /** Ligin o türden dışlananlarını verilen listeyle değiştirir (values: tam liste; boş = hiçbiri dışlanmaz). */
    public function update(Request $request, array $user): array
    {
        [$league, $kind] = self::validatedLeagueKind($request->input('league'), $request->input('kind'));
        $values = [];
        foreach ((array) $request->input('values', []) as $v) {
            $v = trim((string) $v);
            if ($kind === 'user') {
                $v = mb_strtolower($v);
            }
            if ($v !== '' && mb_strlen($v) <= 255) {
                $values[$v] = true;
            }
        }
        $values = array_keys($values);
        if (count($values) > 1000) {
            throw ApiError::badRequest('En fazla 1000 kayıt lig dışı bırakılabilir.');
        }
        $before = self::leagueExcludedValues($league, $kind);
        Db::transaction(function () use ($league, $kind, $values, $user) {
            Db::exec('DELETE FROM league_exclusions WHERE league = ? AND kind = ? AND value <> ALL(?::text[])',
                [$league, $kind, Db::textArray($values)]);
            foreach ($values as $v) {
                Db::exec('INSERT INTO league_exclusions (league, kind, value, created_by) VALUES (?, ?, ?, ?)
                          ON CONFLICT DO NOTHING', [$league, $kind, $v, (string) ($user['username'] ?? '')]);
            }
        });
        $added = array_values(array_diff($values, $before));
        $removed = array_values(array_diff($before, $values));
        if ($added || $removed) {
            Audit::log($user, $request, 'leagues.exclude', "$league/$kind", ['added' => $added, 'removed' => $removed]);
        }
        return ['ok' => true, 'excluded' => self::leagueExcludedValues($league, $kind)];
    }

    /** @return array{0:string,1:string} */
    private static function validatedLeagueKind(mixed $league, mixed $kind): array
    {
        $league = (string) $league;
        $kind = (string) $kind;
        if (!in_array($kind, self::LEAGUE_EXCLUSION_KINDS[$league] ?? [], true)) {
            throw ApiError::badRequest('Geçersiz lig ya da tür.');
        }
        return [$league, $kind];
    }
}
