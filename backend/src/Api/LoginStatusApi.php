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

/**
 * Giriş ekranının durum satırı (frontend ui/Login.js): oturum açmadan görülür, bu yüzden YALNIZ
 * sayılar döner — tahta adı/IP'si, sorun ayrıntısı yok.
 *
 * Acil sorun: her tahtanın EN SON başarılı otomatik sorun tespiti taramasının genel düzeyi "bad"
 * olan tahta sayısı (bkz. worker executor/diagnose.py, tasks/diagnose_schedule.py). Elle yapılan
 * taramalar sayılmaz; tahta başına yalnız son otomatik sonuç önemlidir (düzelen sorun kalkar).
 */
final class LoginStatusApi
{
    public function status(): array
    {
        $boards = Db::one(
            "SELECT count(*) AS total, count(*) FILTER (WHERE online) AS online FROM boards"
        );
        $urgent = Db::one(
            "SELECT count(*) FILTER (WHERE level = 'bad') AS boards, max(finished_at) AS last
             FROM (
                 SELECT DISTINCT ON (t.board_id) t.board_id,
                        CASE WHEN t.output ~ '^\\s*\\{' THEN t.output::jsonb->>'level' END AS level,
                        extract(epoch FROM j.finished_at)::bigint AS finished_at
                 FROM job_targets t JOIN jobs j ON j.id = t.job_id
                 JOIN boards b ON b.id = t.board_id
                 WHERE j.type = 'diagnose' AND t.status = 'ok' AND COALESCE((j.params->>'auto')::boolean, false)
                 ORDER BY t.board_id, j.id DESC
             ) last_scan"
        );
        $total = (int) $boards['total'];
        $online = (int) $boards['online'];
        return [
            'online' => $online,
            'offline' => $total - $online,
            'urgent' => (int) $urgent['boards'],
            'scanned_at' => $urgent['last'] !== null ? (int) $urgent['last'] : null,
        ];
    }
}
