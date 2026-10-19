<?php
declare(strict_types=1);

namespace Tihamon\Api;

use Tihamon\Core\ApiError;
use Tihamon\Core\Audit;
use Tihamon\Core\Db;
use Tihamon\Core\Request;

/**
 * Oturumlar — iki tür, tek listede (her satırda `kind`):
 *  - "board": tahta (greeter) oturumları — worker/tihamon/tasks/board_sessions.py'nin lightdm PAM
 *    loglarından çıkardığı gerçek kullanıcı oturum açma/kapama kayıtları (bkz. 007_board_sessions.sql).
 *  - "webshell": Tiha-Mon üzerinden açılan web terminal (SSH) oturumları; username Tiha-Mon
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
}
