<?php
declare(strict_types=1);

namespace Ankamon\Api;

use Ankamon\Core\ApiError;
use Ankamon\Core\Audit;
use Ankamon\Core\Db;
use Ankamon\Core\Request;
use Ankamon\Core\Storage;

/**
 * Oturumlar — iki tür, tek listede (her satırda `kind`):
 *  - "board": tahta (greeter) oturumları — worker/ankamon/tasks/board_sessions.py'nin lightdm PAM
 *    loglarından çıkardığı gerçek kullanıcı oturum açma/kapama kayıtları (bkz. 007_board_sessions.sql).
 *  - "webshell": Ankamon üzerinden açılan web terminal (SSH) oturumları; username Ankamon
 *    kullanıcısıdır (bkz. 011_webshell_sessions.sql, docker/rootfs/webssh-hook.py).
 * Silmede kimlikler türe göre ayrı gelir (ids / webshell_ids) — iki tablonun kimlikleri çakışabilir.
 * Arayüz tüm satırları tek seferde çekip (Tahtalar grid'iyle aynı desen) sütun bazlı filtre + yerleşik
 * sıralamayla gösterir — veri hacmi (tahta başına günde birkaç oturum) buna uygundur.
 */
final class SessionsApi
{
    // locked: sürmekte olan oturum ekran kilidinde mi — Tahtalar grid'iyle aynı kaynak (session_probe'un
    // boards.session_* alanları, bkz. 012_board_session_state.sql). Yalnız tahtadaki etkin oturumun
    // kullanıcısı bu satırın kullanıcısıysa ve bilgi tazeyse (yoklama tahta erişilebilirken 30 sn'de bir).
    private const COLUMNS = "s.id, s.board_id, COALESCE(NULLIF(b.label, ''), s.host) AS board, s.host,
        s.username, s.uid,
        extract(epoch FROM s.started_at)::bigint AS started_at,
        extract(epoch FROM s.ended_at)::bigint AS ended_at,
        s.end_reason, s.end_detail,
        (s.ended_at IS NULL AND b.session_locked AND b.session_username = s.username
         AND b.session_checked_at > now() - interval '5 minutes') AS locked";

    public function index(Request $request): array
    {
        $limit = $request->queryInt('limit', 5000, 1, 20000);
        $rows = Db::all(
            'SELECT ' . self::COLUMNS . '
             FROM board_sessions s LEFT JOIN boards b ON b.id = s.board_id
             ORDER BY s.started_at DESC LIMIT ?',
            [$limit]
        );
        $shells = Db::all(
            "SELECT w.id, w.board_id, COALESCE(NULLIF(b.label, ''), NULLIF(w.board_name, ''), w.ip) AS board, w.ip AS host,
                    w.username, NULL::integer AS uid,
                    extract(epoch FROM w.started_at)::bigint AS started_at,
                    extract(epoch FROM w.ended_at)::bigint AS ended_at,
                    w.end_reason, NULL::text AS end_detail, false AS locked
             FROM webshell_sessions w LEFT JOIN boards b ON b.id = w.board_id
             WHERE w.started_at IS NOT NULL
             ORDER BY w.started_at DESC LIMIT ?",
            [$limit]
        );
        foreach ($rows as &$row) {
            $row['kind'] = 'board';
        }
        foreach ($shells as &$row) {
            $row['kind'] = 'webshell';
        }
        unset($row);
        $all = array_merge($rows, $shells);
        usort($all, fn($a, $b) => $b['started_at'] <=> $a['started_at']);
        return ['sessions' => $all];
    }

    /**
     * Verilen kimliklerdeki oturum kayıtlarını siler — arayüz, kullanıcının o an UYGULADIĞI
     * süzgeçte GÖRÜNEN satırların kimliklerini gönderir (bkz. page.Sessions): "ekranda ne
     * görüyorsan onu silersin" garantisi, sunucuda ayrı bir süzgeç mantığı tekrarlanmaz. Yetki
     * 'sessions.manage' — yalnız yönetici ya da bu özelliği açıkça açılmış kullanıcı.
     */
    public function delete(Request $request, array $user): array
    {
        $ids = array_values(array_unique(array_map('intval', (array) $request->input('ids', []))));
        $shellIds = array_values(array_unique(array_map('intval', (array) $request->input('webshell_ids', []))));
        if (!$ids && !$shellIds) {
            throw ApiError::badRequest('Silinecek kayıt seçilmedi.');
        }
        $deleted = 0;
        foreach (['board_sessions' => $ids, 'webshell_sessions' => $shellIds] as $table => $list) {
            if ($list) {
                $placeholders = implode(',', array_fill(0, count($list), '?'));
                $deleted += Db::exec("DELETE FROM $table WHERE id IN ($placeholders)", $list);
            }
        }
        Audit::log($user, $request, 'sessions.delete', '', ['count' => $deleted, 'ids' => $ids, 'webshell_ids' => $shellIds]);
        return ['ok' => true, 'deleted' => $deleted];
    }

    /**
     * Tahtalar'a kayıtlı OLMAYAN bir bilgisayarın (log gönderen ama eklenmemiş, ya da yeniden kurulup
     * adı değişmiş eski tahta) kayıtlarını siler: tahtaya bağlanmamış oturumları (board_sessions,
     * board_id NULL) ve açık/kapalı aralıklarını (board_uptime); `logs` verilirse ham loglarını da.
     * Oturum/aralık çıkarıcıları loglarda kaldıkları yerden ilerlediği için silinenler geri gelmez —
     * bilgisayar log göndermeyi sürdürürse yalnız yeni kayıtlar oluşur.
     * Ad kayıtlı bir tahtanın bilgisayar adıysa (eski, tahtaya bağlanmamış oturum satırları) yalnız o
     * satırlar silinir; açık/kapalı aralıkları ve loglar tahtanındır, dokunulmaz.
     */
    public function deleteHost(Request $request, array $user): array
    {
        $host = trim((string) $request->input('host', ''));
        if ($host === '') {
            throw ApiError::badRequest('Bilgisayar seçilmedi.');
        }
        $registered = Db::value('SELECT count(*) FROM boards WHERE lower(hostname) = lower(?)', [$host]) > 0;
        $withLogs = !$registered && (bool) $request->input('logs', false);
        $statements = [['DELETE FROM board_sessions WHERE host = ? AND board_id IS NULL', [$host]]];
        if (!$registered) {
            $statements[] = ['DELETE FROM board_uptime WHERE host = ?', [$host]];
        }
        if ($withLogs) {
            // logs sıkıştırılmış chunk'larda durur: düz DELETE açma sınırına takılır (bkz. Storage).
            $statements[] = ['DELETE FROM logs WHERE lower(host) = lower(?)', [$host]];
        }
        $counts = Storage::delete($statements);
        $result = [
            'sessions' => $counts[0],
            'uptime' => $registered ? 0 : $counts[1],
            'logs' => $withLogs ? $counts[2] : 0,
            'registered' => $registered,
        ];
        Audit::log($user, $request, 'sessions.delete_host', $host, $result);
        return ['ok' => true] + $result;
    }
}
