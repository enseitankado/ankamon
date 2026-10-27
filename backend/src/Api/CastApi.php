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
use Ankamon\Core\Db;
use Ankamon\Core\Request;

/**
 * Ekran yansıtma penceresinin canlı tüketim tablosu (docker/rootfs/cast/index.html): bir yayını okuyan
 * tahtaların sunucudan çektiği veri miktarı. MediaMTX denetim API'si (yalnız 127.0.0.1, bkz.
 * docker/rootfs/services/mediamtx.sh) tahta başına bir RTSP oturumu verir; uzak adres boards.ip ile
 * eşleştirilir. Hız (Mbit/sn) pencerede iki örnek arasındaki farktan hesaplanır. CPU/RAM ayrı kanaldan
 * gelir (nginx /cast/ws/perf/, worker/ankamon/screen/perf.py).
 */
final class CastApi
{
    public function stats(Request $request): array
    {
        $stream = (string) $request->query('stream', '');
        if (!preg_match('/^c-[A-Za-z0-9]{24,64}$/', $stream)) {
            throw ApiError::badRequest('Geçersiz yayın adı.');
        }
        $port = (int) (getenv('CAST_API_PORT') ?: 9997);
        $ctx = stream_context_create(['http' => ['timeout' => 2]]);
        $raw = @file_get_contents("http://127.0.0.1:$port/v3/rtspsessions/list?itemsPerPage=1000", false, $ctx);
        if ($raw === false) {
            throw new ApiError(503, 'Yansıtma sunucusuna (MediaMTX) ulaşılamadı.');
        }
        $sessions = json_decode($raw, true)['items'] ?? [];

        $byIp = [];
        foreach ($sessions as $s) {
            // Yalnız OKUYUCULAR (tahtalar); yayıncının kendi oturumu ("publish", 127.0.0.1) sayılmaz.
            if (($s['path'] ?? '') !== $stream || ($s['state'] ?? '') !== 'read') {
                continue;
            }
            // remoteAddr: "192.168.23.160:51234" ya da "[fe80::1]:51234"
            $ip = preg_replace('/^\[?(.*?)\]?:\d+$/', '$1', (string) ($s['remoteAddr'] ?? ''));
            $byIp[$ip] = [
                'ip' => $ip,
                'bytes_sent' => ($byIp[$ip]['bytes_sent'] ?? 0) + (int) ($s['bytesSent'] ?? 0),
                'state' => $s['state'] ?? '',
                'since' => $s['created'] ?? null,
            ];
        }
        if ($byIp) {
            $placeholders = implode(',', array_fill(0, count($byIp), '?::inet'));
            foreach (Db::all("SELECT id, host(ip) AS ip FROM boards WHERE ip IN ($placeholders)", array_keys($byIp)) as $b) {
                $byIp[$b['ip']]['board_id'] = (int) $b['id'];
            }
        }
        return ['ts' => (int) round(microtime(true) * 1000), 'readers' => array_values($byIp)];
    }
}
