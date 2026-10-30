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

namespace Ankamon\Core;

/**
 * Ağ cihazlarına sistem ping aracıyla (/bin/ping) paket atar: her IP için ayrı süreç, hepsi aynı anda; toplam
 * süre cihaz sayısından bağımsızdır. Kabuk kullanılmaz (argüman dizisi), IP'ler yalnız veritabanından gelir.
 */
final class DevicePing
{
    public const MAX_TARGETS = 256;
    private const PACKETS = '4';
    private const REPLY_WAIT = '1';   // yanıt yoksa ping'in son paketten sonra bekleyeceği sn (-W)
    private const DEADLINE = 8.0;     // takılan süreç bu sürede kesilir (4 paket normalde ≤ ~4 sn)

    /** @return array<string, array> ip => {ip, ok, transmitted, received, loss, min, avg, max, output} */
    public static function run(array $ips): array
    {
        $procs = [];
        foreach (array_unique($ips) as $ip) {
            $pipes = [];
            $proc = proc_open(
                ['/bin/ping', '-c', self::PACKETS, '-W', self::REPLY_WAIT, $ip],
                [0 => ['file', '/dev/null', 'r'], 1 => ['pipe', 'w'], 2 => ['redirect', 1]],
                $pipes
            );
            if (!is_resource($proc)) {
                $procs[$ip] = ['proc' => null, 'pipe' => null, 'output' => 'ping başlatılamadı'];
                continue;
            }
            stream_set_blocking($pipes[1], false);
            $procs[$ip] = ['proc' => $proc, 'pipe' => $pipes[1], 'output' => ''];
        }

        // Çıktılar birlikte okunur: sırayla okunsaydı dolan boru diğer süreçleri bekletirdi.
        $deadline = microtime(true) + self::DEADLINE;
        while (($read = array_values(array_filter(array_column($procs, 'pipe')))) && microtime(true) < $deadline) {
            $write = $except = null;
            if (stream_select($read, $write, $except, 0, 200000) === false) {
                break;
            }
            foreach ($procs as $ip => $entry) {
                if ($entry['pipe'] && in_array($entry['pipe'], $read, true)) {
                    $procs[$ip]['output'] .= (string) fread($entry['pipe'], 8192);
                    if (feof($entry['pipe'])) {
                        fclose($entry['pipe']);
                        $procs[$ip]['pipe'] = null;
                    }
                }
            }
        }

        $results = [];
        foreach ($procs as $ip => $entry) {
            if ($entry['pipe']) {
                fclose($entry['pipe']);
            }
            if ($entry['proc']) {
                proc_terminate($entry['proc'], 9);
                proc_close($entry['proc']);
            }
            $results[$ip] = self::parse((string) $ip, $entry['output']);
        }
        return $results;
    }

    /** ping özet satırlarını ayrıştırır: "4 packets transmitted, 3 packets received, 25% packet loss", "min/avg/max = a/b/c ms". */
    private static function parse(string $ip, string $output): array
    {
        $sent = $received = 0;
        if (preg_match('~(\d+) packets transmitted, (\d+) (?:packets )?received~', $output, $m)) {
            [$sent, $received] = [(int) $m[1], (int) $m[2]];
        }
        $times = preg_match('~= ([\d.]+)/([\d.]+)/([\d.]+)~', $output, $t) ? array_map('floatval', array_slice($t, 1, 3)) : [null, null, null];
        return [
            'ip' => $ip,
            'ok' => $received > 0,
            'transmitted' => $sent,
            'received' => $received,
            'loss' => $sent > 0 ? (int) round(100 * ($sent - $received) / $sent) : null,
            'min' => $times[0],
            'avg' => $times[1],
            'max' => $times[2],
            'output' => trim($output),
        ];
    }
}
