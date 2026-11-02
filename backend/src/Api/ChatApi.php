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
use Ankamon\Core\Storage;

/** Sohbet geçmişi (Oturumlar ▸ Sohbet geçmişi) ve Disk kullanımı sekmesi; canlı sohbet: worker screen/chat.py. */
final class ChatApi
{
    public function messages(Request $request): array
    {
        return ['messages' => Db::all(
            "SELECT id, board_id, board_name, session_username, direction, author, body,
                    extract(epoch FROM sent_at)::bigint AS sent_at
             FROM chat_messages ORDER BY sent_at DESC, id DESC LIMIT 5000"
        )];
    }

    /** Disk kullanımı: tahta (ad) başına ileti sayısı, ilk/son; boyut tablodan orantılı (tahmini). */
    public function stats(Request $request): array
    {
        $bytes = Storage::relationBytes('chat_messages');
        $boards = Db::all(
            "SELECT board_name AS name, count(*) AS n,
                    (extract(epoch FROM min(sent_at)) * 1000)::bigint AS first,
                    (extract(epoch FROM max(sent_at)) * 1000)::bigint AS last
             FROM chat_messages GROUP BY board_name ORDER BY n DESC"
        );
        $total = array_sum(array_column($boards, 'n'));
        foreach ($boards as &$board) {
            $board['est_bytes'] = Storage::share($bytes, (int) $board['n'], $total);
        }
        unset($board);
        return [
            'boards' => $boards,
            'total' => [
                'n' => $total, 'bytes' => $bytes,
                'first' => $boards ? min(array_column($boards, 'first')) : null,
                'last' => $boards ? max(array_column($boards, 'last')) : null,
            ],
            'disk' => Storage::diskSpace(),
        ];
    }

    /** Kalıcı silme: name=<kayıttaki tahta adı> ya da all=1. Geri alınamaz; audit_log'a yazılır. */
    public function delete(Request $request, array $user): array
    {
        if ($request->query('all') === '1') {
            $scope = 'tümü';
            $deleted = Db::exec('DELETE FROM chat_messages');
        } else {
            $scope = (string) $request->query('name', '');
            if ($scope === '') {
                throw ApiError::badRequest('Silinecek kapsam seçilmedi.');
            }
            $deleted = Db::exec('DELETE FROM chat_messages WHERE board_name = ?', [$scope]);
        }
        Audit::log($user, $request, 'chat.delete', $scope, ['deleted' => $deleted]);
        return ['ok' => true, 'deleted' => $deleted];
    }
}
