<?php
declare(strict_types=1);

namespace Tihamon\Api;

use Tihamon\Core\Auth;
use Tihamon\Core\Db;
use Tihamon\Core\Request;

/**
 * Tiha-Mon'un KENDİ kullanıcılarının oturum geçmişi (login_sessions, göç 019) — tahtalardaki kullanıcı
 * oturumları (board_sessions, "sessions.*" yetkileri) DEĞİL. Kullanıcılar ▸ Oturumlar sekmesi ve alt
 * çubuktaki "oturum açmış kullanıcılar" göstergesi kullanır. Ayrıntı 'logins' yetkisi ister; alt çubuk
 * sayısı her oturum sahibine açıktır (bkz. active()).
 */
final class LoginSessionsApi
{
    /**
     * Bağlantı ölçütü: açık bir Tiha-Mon sekmesi alt çubuktan sürekli istek atar (saniyede bir; arka plandaki
     * sekmeyi tarayıcı en çok dakikada bire kısar) ve Auth::user last_seen_at'i dakikada bir yazar. Son istek
     * bundan eskiyse tarayıcı kapanmış/sekme kapatılmış sayılır ("bağlantı kesildi") — belirteç hâlâ geçerli
     * olsa da (çıkış yapmadan kapatılan tarayıcı) oturum "açık" gösterilmez (göç 021).
     */
    private const PRESENCE_MINUTES = 3;
    /** "Aktif" (sekme görünür + pencere odakta) bildirimi bundan eskiyse sayılmaz (tarayıcı 15 sn'de bir yeniler). */
    private const FOCUS_STALE_SECONDS = 40;
    /**
     * Bundan kısa, işlemsiz (giriş/çıkış dışında audit kaydı yok) ve bitmiş/bağlantısı kesilmiş oturumlar
     * geçmişten silinir (göç 022): betik/test girişleri ve yanlışlıkla açılıp kapanan sekmeler listeyi
     * kirletmesin (kullanıcı isteği, 2026-10-19). Giriş/çıkış audit_log'da kalır.
     */
    private const SHORT_SECONDS = 20;

    /**
     * Oturumun yapıldığı bilgisayar (kullanıcı isteği): IP → MAC (ağ envanteri net_devices, yoksa tahtalar) →
     * takma ad (tahtanın takma adı, ağ envanterindeki etiket, bilinen takma adlar); takma ad yoksa MAC.
     * Eşleme kayıt anındaki IP ile GÜNCEL envanter üzerinden yapılır (DHCP ile IP değişmiş olabilir).
     */
    private const COMPUTER_JOIN = "
             LEFT JOIN LATERAL (
               SELECT m.mac FROM (
                 SELECT d.mac, 1 AS pr, d.last_seen_at AS seen FROM net_devices d
                  WHERE d.ip = CASE WHEN ls.ip ~ '^[0-9.]+$' THEN ls.ip::inet END
                 UNION ALL
                 SELECT b.mac, 2, b.last_seen_at FROM boards b
                  WHERE b.ip = CASE WHEN ls.ip ~ '^[0-9.]+$' THEN ls.ip::inet END AND b.mac IS NOT NULL
               ) m ORDER BY m.pr, m.seen DESC NULLS LAST LIMIT 1
             ) pc ON true
             LEFT JOIN LATERAL (
               SELECT coalesce(
                 (SELECT nullif(b.label, '') FROM boards b WHERE b.mac = pc.mac AND b.label <> '' LIMIT 1),
                 (SELECT nullif(d.label, '') FROM net_devices d WHERE d.mac = pc.mac AND d.label <> ''
                   ORDER BY d.last_seen_at DESC NULLS LAST LIMIT 1),
                 (SELECT k.label FROM net_known_aliases k WHERE k.mac = pc.mac)) AS alias
             ) pa ON true";

    /** Belirteç geçerli + son istek taze: tarayıcıda açık. */
    private const PRESENT = "(s.id IS NOT NULL AND s.expires_at > now()
                              AND coalesce(ls.last_seen_at, ls.started_at) > now() - make_interval(mins => %d))";

    /**
     * Oturum durumu: active (açık, sekme odakta) / open (açık, arka planda) / gone (çıkış yapılmadan tarayıcı
     * kapandı) / logout / replaced (yeniden giriş) / revoked / expired.
     */
    private static function status(): string
    {
        $present = sprintf(self::PRESENT, self::PRESENCE_MINUTES);
        return "CASE WHEN ls.ended_at IS NOT NULL THEN ls.end_reason
                     WHEN ls.expires_at IS NOT NULL AND ls.expires_at <= now() THEN 'expired'
                     WHEN s.id IS NULL THEN 'revoked'
                     WHEN NOT $present THEN 'gone'
                     WHEN ls.focused AND ls.focus_at > now() - make_interval(secs => " . self::FOCUS_STALE_SECONDS . ") THEN 'active'
                     ELSE 'open' END";
    }

    /**
     * Oturumun GERÇEK bitişi (süre bundan hesaplanır): çıkış/yeniden giriş anı; kendiliğinden biten (süre
     * dolma, sonlandırma, bağlantı kesilmesi) oturumda son istek anı — belirtecin geçerlilik süresi değil.
     * Hâlâ açıksa NULL (sürüyor).
     */
    private static function endExpr(): string
    {
        $present = sprintf(self::PRESENT, self::PRESENCE_MINUTES);
        return "CASE WHEN ls.end_reason IN ('logout', 'replaced') THEN ls.ended_at
                     WHEN ls.ended_at IS NULL AND $present THEN NULL
                     ELSE least(coalesce(ls.ended_at, now()), coalesce(ls.last_seen_at, ls.started_at)) END";
    }

    /** Kısa + işlemsiz + artık bağlı olmayan oturum kayıtlarını siler (bkz. SHORT_SECONDS); bağlı audit satırları çözülür. */
    private static function purgeShort(): void
    {
        $present = sprintf(self::PRESENT, self::PRESENCE_MINUTES);
        Db::exec(
            "WITH gone AS (
               DELETE FROM login_sessions ls
                WHERE coalesce(ls.last_seen_at, ls.started_at) < ls.started_at + make_interval(secs => ?)
                  AND NOT EXISTS (SELECT 1 FROM sessions s WHERE s.id = ls.session_hash AND $present)
                  AND NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.login_session_id = ls.id
                                   AND a.action NOT IN ('login', 'logout'))
               RETURNING ls.id)
             UPDATE audit_log SET login_session_id = NULL WHERE login_session_id IN (SELECT id FROM gone)",
            [self::SHORT_SECONDS]
        );
    }

    public function index(Request $request): array
    {
        self::purgeShort();
        $days = $request->queryInt('days', 30, 1, 365);
        $limit = $request->queryInt('limit', 2000, 1, 10000);
        $status = self::status();
        $end = self::endExpr();
        $rows = Db::all(
            "SELECT ls.id, ls.username, u.full_name, ls.ip, ls.user_agent,
                    (extract(epoch FROM ls.started_at) * 1000)::bigint AS started_ts,
                    (extract(epoch FROM ls.last_seen_at) * 1000)::bigint AS last_seen_ts,
                    (extract(epoch FROM $end) * 1000)::bigint AS ended_ts,
                    $status AS status,
                    (SELECT count(*) FROM audit_log a WHERE a.login_session_id = ls.id) AS actions,
                    (SELECT string_agg(DISTINCT a.action, ', ' ORDER BY a.action) FROM audit_log a
                      WHERE a.login_session_id = ls.id AND a.action NOT IN ('login', 'logout')) AS action_names,
                    CASE WHEN ls.ip IN ('127.0.0.1', '::1') THEN 'Tiha-Mon sunucusu'
                         ELSE coalesce(pa.alias, pc.mac::text) END AS computer,
                    pc.mac::text AS computer_mac
             FROM login_sessions ls
             LEFT JOIN sessions s ON s.id = ls.session_hash
             LEFT JOIN users u ON u.id = ls.user_id" . self::COMPUTER_JOIN . "
             WHERE ls.started_at > now() - make_interval(days => ?)
             ORDER BY ls.started_at DESC LIMIT $limit",
            [$days]
        );
        return ['sessions' => $rows, 'presence_minutes' => self::PRESENCE_MINUTES];
    }

    /** Bir oturumda yapılan işlemler (audit_log), eskiden yeniye. */
    public function actions(Request $request): array
    {
        $id = (int) $request->args['id'];
        return ['actions' => Db::all(
            "SELECT (extract(epoch FROM time) * 1000)::bigint AS ts, action, target, detail, ip
             FROM audit_log WHERE login_session_id = ? ORDER BY id LIMIT 5000",
            [$id]
        )];
    }

    /**
     * Alt çubuk: şu an BAĞLI (belirteci geçerli VE son isteği PRESENCE_MINUTES'tan taze — çıkış yapmadan
     * kapatılan tarayıcılar sayılmaz, göç 021) kullanıcı sayısı (her oturum sahibi görür) + 'logins' yetkisi
     * olana liste. Liste kullanıcı+IP başına TEK satır (aynı tarayıcıdan çıkış yapmadan tekrar tekrar girilince
     * ipucu yüzlerce satıra uzamasın): son giriş, oturum sayısı, son etkinlik; şu an etkin olanlar üstte.
     *
     * `?focused=0|1` (alt çubuk gönderir; göç 020): çağıran oturumun Tiha-Mon sekmesi görünür VE tarayıcı
     * penceresi odakta mı. `active` = gruptaki bir oturum odakta ve bildirimi FOCUS_STALE_SECONDS'tan taze
     * (sekme kapanınca/ağ gidince bildirim kesilir, kendiliğinden düşer) → ipucunda yeşil "Aktif".
     */
    public function active(Request $request, array $user): array
    {
        $focused = $request->query('focused');
        if ($focused !== null && $focused !== '') {
            // Durum bildirimini YALNIZ arayüz (alt çubuk) gönderir: oturumun geçmiş kaydı burada, arayüz ilk
            // açıldığında oluşur (göç 022) — yalnız API kullanan betikler kayıt bırakmaz. Bildirim son etkinliği de
            // yazar (15 sn'de bir; Auth::user dakikada bir yazar) — süreler 0 sn görünmesin.
            $focusedDb = $focused === '1' ? 't' : 'f';
            if (empty($user['login_session_id'])) {
                $id = Db::value(
                    "INSERT INTO login_sessions (session_hash, user_id, username, ip, user_agent, started_at,
                                                 last_seen_at, expires_at, focused, focus_at)
                     SELECT s.id, s.user_id, u.username, s.ip, s.user_agent, s.created_at, now(), s.expires_at, ?, now()
                     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?
                     ON CONFLICT (session_hash) DO UPDATE SET last_seen_at = now(), focused = EXCLUDED.focused, focus_at = now()
                     RETURNING id",
                    [$focusedDb, $user['session_id']]
                );
                if ($id) {
                    $user['login_session_id'] = (int) $id;
                    // Girişin audit kaydı (oturum o anda henüz kayıtlı değildi) bu oturuma bağlanır.
                    Db::exec(
                        "UPDATE audit_log a SET login_session_id = ? FROM sessions s
                          WHERE s.id = ? AND a.login_session_id IS NULL AND a.user_id = s.user_id
                            AND a.action = 'login' AND a.ip = s.ip AND a.time BETWEEN s.created_at - interval '5 seconds' AND now()",
                        [(int) $id, $user['session_id']]
                    );
                }
            } else {
                Db::exec('UPDATE login_sessions SET focused = ?, focus_at = now(), last_seen_at = now() WHERE id = ?',
                    [$focusedDb, $user['login_session_id']]);
            }
        }
        $rows = Db::all(
            "SELECT ls.username, max(u.full_name) AS full_name, ls.ip, count(*) AS sessions,
                    (extract(epoch FROM max(ls.started_at)) * 1000)::bigint AS started_ts,
                    (extract(epoch FROM max(ls.last_seen_at)) * 1000)::bigint AS last_seen_ts,
                    bool_or(ls.focused AND ls.focus_at > now() - make_interval(secs => ?)) AS active,
                    bool_or(ls.id = ?) AS mine
             FROM sessions s
             JOIN login_sessions ls ON ls.session_hash = s.id
             LEFT JOIN users u ON u.id = ls.user_id
             WHERE " . sprintf(self::PRESENT, self::PRESENCE_MINUTES) . "
             GROUP BY ls.username, ls.ip
             ORDER BY active DESC, max(ls.last_seen_at) DESC",
            [self::FOCUS_STALE_SECONDS, $user['login_session_id'] ?? 0]
        );
        $users = count(array_unique(array_column($rows, 'username')));
        if (!Auth::can($user, 'logins')) {
            return ['users' => $users, 'sessions' => null];
        }
        return ['users' => $users, 'sessions' => $rows, 'total' => (int) array_sum(array_column($rows, 'sessions'))];
    }
}
