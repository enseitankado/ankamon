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
use Ankamon\Core\Request;

/**
 * SSH etkinliği (kullanıcı isteği 2026-11-10: alt çubuk ▸ SSH paneli ▸ pencere): Ankamon konteynerinin dışarıya açtığı
 * bütün SSH bağlantıları ve gönderdiği komutlar, canlı.
 *
 * Kaynak: /run/ankamon/ssh-activity/log — satır başına bir JSON olay. Yazanlar: sshpass sarmalayıcısı
 * (docker/rootfs/ankamon-sshpass.sh — worker, runner, ekran, dosya, ansible … çağrılarının hepsi oradan geçer),
 * worker/ankamon/sshactivity.py (sshfs) ve webssh kancası (web terminal). "password" türü eylem parametreleri
 * yazılmadan önce maskelenir; parolalar zaten argv'de değildir (sshpass -e).
 *
 * Artımlı okuma: istemci dosyanın inode'unu ve bayt konumunu geri gönderir (ino/off); dosya ~3 MB'da .1'e döner,
 * inode değiştiyse önce .1'in kalanı okunur. Yalnız yönetici (komutlar tahtalara giden betiklerdir).
 */
final class SshActivityApi
{
    private const DIR = '/run/ankamon/ssh-activity';
    /** İlk yüklemede dosya sonundan okunacak en çok bayt ve olay. */
    private const INITIAL_BYTES = 1500000;
    private const MAX_EVENTS = 3000;

    public function index(Request $request, array $user): array
    {
        $log = self::DIR . '/log';
        $old = $log . '.1';
        clearstatcache();
        $ino = @fileinode($log) ?: 0;
        $size = @filesize($log) ?: 0;
        $qIno = (int) ($request->query('ino') ?? 0);
        $qOff = $request->query('off');
        $chunks = [];
        $end = $size;
        $initial = $qOff === null || $qOff === '';
        if ($initial) {
            $need = self::INITIAL_BYTES;
            if ($size < $need && is_file($old)) {
                $oldSize = @filesize($old) ?: 0;
                $chunks[] = $this->read($old, max(0, $oldSize - ($need - $size)), $oldSize)[0];
            }
            [$chunks[], $end] = $this->read($log, max(0, $size - $need), $size);
        } else {
            $off = max(0, (int) $qOff);
            if ($qIno && $qIno !== $ino) {
                // Dosya döndü: eski dosya (artık .1) kaldığı yerden, yenisi baştan.
                if (is_file($old) && (@fileinode($old) ?: 0) === $qIno) {
                    $chunks[] = $this->read($old, $off, @filesize($old) ?: 0)[0];
                }
                $off = 0;
            }
            if ($off > $size) {
                $off = 0; // kesilmiş/yeniden oluşmuş
            }
            [$chunks[], $end] = $this->read($log, $off, $size);
        }

        $events = [];
        foreach ($chunks as $text) {
            foreach (explode("\n", $text) as $line) {
                if ($line === '') {
                    continue;
                }
                $ev = json_decode($line, true, 8, JSON_INVALID_UTF8_SUBSTITUTE);
                if (is_array($ev) && isset($ev['ev'], $ev['pid'])) {
                    $events[] = $ev;
                }
            }
        }
        if (count($events) > self::MAX_EVENTS) {
            $events = array_slice($events, -self::MAX_EVENTS);
        }

        // Bitiş kaydı hiç gelmeyecek bağlantılar (konteyner yeniden başladı, izleyici öldürüldü): süreç yoksa kayıp.
        $gone = [];
        $check = [];
        if ($initial) {
            $open = [];
            foreach ($events as $ev) {
                $key = $ev['pid'] . ':' . ($ev['ev'] === 'start' ? $ev['ts'] : ($ev['start'] ?? 0));
                if ($ev['ev'] === 'start') {
                    $open[$key] = $ev['pid'];
                } else {
                    unset($open[$key]);
                }
            }
            foreach ($open as $key => $pid) {
                $check[$key] = $pid;
            }
        } else {
            foreach (array_slice(explode(',', (string) ($request->query('open') ?? '')), 0, 500) as $key) {
                if (preg_match('/^(\d+):(\d+)$/', $key, $m)) {
                    $check[$key] = $m[1];
                }
            }
        }
        foreach ($check as $key => $pid) {
            if (is_int($pid) || ctype_digit((string) $pid)) {
                $cmd = @file_get_contents('/proc/' . $pid . '/cmdline');
                if ($cmd === false || strpos($cmd, 'sshpass') === false) {
                    $gone[] = $key;
                }
            }
        }

        return [
            'ino' => $ino,
            'off' => $end,
            'events' => $events,
            'gone' => $gone,
            'names' => $this->names($events),
            'now' => time(),
        ];
    }

    /**
     * [$from, $to) aralığındaki TAM satırlar ve okunan son satır sonunun konumu. $from bir satırın ortasındaysa
     * (ilk yükleme dosya sonundan başlar) yarım ilk satır atılır; son satır yarımsa (yazım sürüyor) sonraki tura kalır.
     * @return array{0: string, 1: int}
     */
    /**
     * Bir SSH çağrısının çıktısı (kullanıcı isteği 2026-11-11: komut penceresinde sonuç). sshpass sarmalayıcısı komutlu,
     * tünelsiz çağrıların stdout/stderr'inin ilk 128 KB'ını out/<pid>-<ts>.out/.err'e yazar (ekran/dosya akışları hariç).
     * ?key=<pid>:<ts>
     */
    public function output(Request $request, array $user): array
    {
        $key = (string) ($request->query('key') ?? '');
        if (!preg_match('/^(\d{1,9}):(\d{1,12})$/', $key, $m)) {
            return ['available' => false, 'reason' => 'Bu bağlantının çıktısı kaydedilmez (etkileşimli/tünel/akış).'];
        }
        $base = self::DIR . '/out/' . $m[1] . '-' . $m[2];
        $read = static function (string $path): ?string {
            if (!is_file($path)) {
                return null;
            }
            $text = (string) @file_get_contents($path, false, null, 0, 131072);
            return mb_convert_encoding($text, 'UTF-8', 'UTF-8');
        };
        $out = $read($base . '.out');
        $err = $read($base . '.err');
        if ($out === null && $err === null) {
            return ['available' => false,
                'reason' => 'Çıktı kaydı yok (ekran/dosya akışı, tünel, web terminal, eski kayıt ya da budanmış).'];
        }
        $size = (@filesize($base . '.out') ?: 0);
        return [
            'available' => true,
            'stdout' => $out ?? '',
            'stderr' => $err ?? '',
            'truncated' => $size >= 131072 || (@filesize($base . '.err') ?: 0) >= 131072,
            // Yazım sürüyor mu (FIFO'lar bağlantı bitince silinir).
            'running' => file_exists($base . '.o1'),
        ];
    }

    /**
     * Ankamon süreçlerinin açık TCP bağlantıları ve anlık trafik (worker/ankamon/connwatch.py yazar). İstek, izleyicinin
     * örneklemeyi sürdürmesi için `want` dosyasına dokunur — pencere kapanınca (istek gelmeyince) örnekleme durur.
     */
    public function connections(Request $request, array $user): array
    {
        @touch(self::DIR . '/want');
        $data = json_decode((string) @file_get_contents(self::DIR . '/conns.json'), true);
        if (!is_array($data) || !isset($data['ts']) || $data['ts'] < time() - 15) {
            return ['ready' => false, 'conns' => [], 'names' => []];
        }
        $ips = [];
        foreach ($data['conns'] ?? [] as $c) {
            if (!empty($c['rip']) && filter_var($c['rip'], FILTER_VALIDATE_IP)) {
                $ips[$c['rip']] = true;
            }
        }
        return ['ready' => true, 'ts' => $data['ts'], 'conns' => $data['conns'] ?? [], 'names' => $this->ipNames(array_keys($ips))];
    }

    private function read(string $path, int $from, int $to): array
    {
        if ($to <= $from) {
            return ['', $from];
        }
        $f = @fopen($path, 'rb');
        if (!$f) {
            return ['', $from];
        }
        $start = max(0, $from - 1);
        fseek($f, $start);
        $text = (string) fread($f, $to - $start);
        fclose($f);
        if ($from > 0) {
            if ($text[0] !== "\n") {
                $nl = strpos($text, "\n");
                $text = $nl === false ? '' : substr($text, $nl + 1);
                $start = $nl === false ? $to : $start + $nl + 1;
            } else {
                $text = substr($text, 1);
                $start++;
            }
        }
        $last = strrpos($text, "\n");
        if ($last === false) {
            return ['', $start];
        }
        return [substr($text, 0, $last + 1), $start + $last + 1];
    }

    /** Hedef IP → tahta takma adı / ağ envanteri adı (grid'de "Cihaz"). */
    private function names(array $events): array
    {
        $ips = [];
        foreach ($events as $ev) {
            if (($ev['ev'] ?? '') === 'start' && !empty($ev['target'])) {
                $ip = substr((string) $ev['target'], (int) strrpos((string) $ev['target'], '@') + (strpos((string) $ev['target'], '@') === false ? 0 : 1));
                if (filter_var($ip, FILTER_VALIDATE_IP)) {
                    $ips[$ip] = true;
                }
            }
        }
        return $this->ipNames(array_keys($ips));
    }

    /** IP listesi → tahta takma adı / ağ envanteri adı. */
    private function ipNames(array $ips): array
    {
        if (!$ips) {
            return [];
        }
        $list = '{' . implode(',', $ips) . '}';
        $rows = Db::all(
            "SELECT ip, name FROM (
                SELECT host(ip) AS ip, COALESCE(NULLIF(label, ''), NULLIF(hostname, '')) AS name, 1 AS pri
                  FROM boards WHERE ip = ANY(?::inet[])
                UNION ALL
                SELECT host(ip), COALESCE(NULLIF(label, ''), NULLIF(hostname, '')), 2
                  FROM net_devices WHERE ip = ANY(?::inet[])
             ) x WHERE name IS NOT NULL ORDER BY pri DESC",
            [$list, $list]
        );
        $names = [];
        foreach ($rows as $row) {
            $names[$row['ip']] = $row['name']; // öncelik: tahta (sonra yazılır)
        }
        return $names;
    }
}
