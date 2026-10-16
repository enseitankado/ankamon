<?php
declare(strict_types=1);

namespace Tihamon\Api;

use Tihamon\Core\ApiError;
use Tihamon\Core\Db;
use Tihamon\Core\Request;

/**
 * Ekran yansıtma penceresinin canlı tüketim tablosu (docker/rootfs/cast/index.html): bir yayını okuyan
 * tahtaların sunucudan çektiği veri miktarı. MediaMTX denetim API'si (yalnız 127.0.0.1, bkz.
 * docker/rootfs/services/mediamtx.sh) tahta başına bir RTSP oturumu verir; uzak adres boards.ip ile
 * eşleştirilir. Hız (Mbit/sn) pencerede iki örnek arasındaki farktan hesaplanır. CPU/RAM ayrı kanaldan
 * gelir (nginx /cast/ws/perf/, worker/tihamon/screen/perf.py).
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
