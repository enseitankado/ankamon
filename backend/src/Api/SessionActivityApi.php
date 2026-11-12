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

/**
 * Oturum hareketleri (Oturumlar ▸ Hareketler): worker'ın log, sensör ve Ankamon işlemlerinden ayıkladığı olaylar (bkz. worker
 * tasks/session_activity.py). Süzme yalnız bu tablodadır, loglara gidilmez. Cihaz, kullanıcı, oturum, tarih ve metin serbestçe
 * birleştirilir: bir cihazın bütün hareketleri, bir kullanıcının bir cihazdaki ya da bütün cihazlardaki hareketleri, tek oturum.
 */
final class SessionActivityApi
{
    public function index(Request $request): array
    {
        $where = ['TRUE'];
        $args = [];
        $deviceId = (string) $request->query('device_id', '');
        if ($deviceId !== '') {
            $where[] = 'a.device_id = ?';
            $args[] = (int) $deviceId;
        }
        $username = (string) $request->query('username', '');
        if ($username === '-') {
            $where[] = 'a.username IS NULL';
        } elseif ($username !== '') {
            $where[] = 'a.username = ?';
            $args[] = $username;
        }
        $sessionId = (string) $request->query('session_id', '');
        if ($sessionId !== '') {
            $where[] = 'a.session_id = ?';
            $args[] = (int) $sessionId;
        }
        $from = (string) $request->query('from', '');
        if ($from !== '') {
            $where[] = 'a.at >= to_timestamp(?)';
            $args[] = (int) $from;
        }
        $to = (string) $request->query('to', '');
        if ($to !== '') {
            $where[] = 'a.at <= to_timestamp(?)';
            $args[] = (int) $to;
        }
        $text = trim((string) $request->query('q', ''));
        if ($text !== '') {
            $where[] = "(a.summary ILIKE ? OR a.detail ILIKE ?)";
            $like = '%' . addcslashes($text, '%_\\') . '%';
            array_push($args, $like, $like);
        }
        $limit = $request->queryInt('limit', 5000, 1, 20000);
        // En yeni $limit satır alınır, ekranda kronolojik (eskiden yeniye) gösterilir.
        $rows = Db::all(
            'SELECT a.id, extract(epoch FROM a.at)::bigint AS at, a.device_id, a.device_name, a.session_id, a.username, a.kind, a.summary, a.detail
             FROM session_activity a WHERE ' . implode(' AND ', $where) . ' ORDER BY a.at DESC, a.id DESC LIMIT ?',
            [...$args, $limit]
        );
        return [
            'events' => array_reverse($rows),
            'limited' => count($rows) >= $limit,
            'devices' => Db::all('SELECT DISTINCT device_id, device_name FROM session_activity ORDER BY device_name'),
            'users' => array_column(Db::all('SELECT DISTINCT username FROM session_activity WHERE username IS NOT NULL ORDER BY username'), 'username'),
        ];
    }

    /** Disk kullanımı: cihaz (ad) başına olay sayısı, ilk/son; boyut tablodan orantılı (tahmini). */
    public function stats(Request $request): array
    {
        $bytes = Storage::relationBytes('session_activity');
        $devices = Db::all(
            "SELECT device_name AS name, count(*) AS n,
                    (extract(epoch FROM min(at)) * 1000)::bigint AS first,
                    (extract(epoch FROM max(at)) * 1000)::bigint AS last
             FROM session_activity GROUP BY device_name ORDER BY n DESC"
        );
        $total = array_sum(array_column($devices, 'n'));
        foreach ($devices as &$device) {
            $device['est_bytes'] = Storage::share($bytes, (int) $device['n'], $total);
        }
        unset($device);
        return [
            'devices' => $devices,
            'total' => [
                'n' => $total, 'bytes' => $bytes,
                'first' => $devices ? min(array_column($devices, 'first')) : null,
                'last' => $devices ? max(array_column($devices, 'last')) : null,
            ],
            'disk' => Storage::diskSpace(),
        ];
    }

    /** Kalıcı silme: name=<cihaz adı> ya da all=1. Ayıklama imleci geri gitmez, silinenler yeniden üretilmez. */
    public function delete(Request $request, array $user): array
    {
        if ($request->query('all') === '1') {
            $scope = 'tümü';
            $deleted = Db::exec('DELETE FROM session_activity');
        } else {
            $scope = (string) $request->query('name', '');
            if ($scope === '') {
                throw ApiError::badRequest('Silinecek kapsam seçilmedi.');
            }
            $deleted = Db::exec('DELETE FROM session_activity WHERE device_name = ?', [$scope]);
        }
        Audit::log($user, $request, 'session-activity.delete', $scope, ['deleted' => $deleted]);
        return ['ok' => true, 'deleted' => $deleted];
    }
}
