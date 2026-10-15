<?php
declare(strict_types=1);

namespace Tihamon\Api;

/**
 * Konteynerin anlık kaynak kullanımı (StatusBar'ın üst çubuğu, 1 sn'de bir yoklanır).
 *
 * Oranlar (CPU, disk, ağ) iki ardışık istek arasındaki farktan hesaplanır; bu yüzden önceki
 * örnek /run/tiha-mon/sysstat-prev.json'da tutulur (PHP-FPM istekler arası durum tutmaz).
 * Veriler cgroup v2'den okunur (Docker varsayılanı) — konteynerin KENDİ kullanımıdır, host'un
 * tamamı değil. Ağ yalnız gerçek arabirimleri sayar (lo/docker/br-/veth hariç); host ağı
 * kullanıldığından (network_mode: host) bu host'un fiziksel arabirimleriyle aynıdır.
 */
final class SystemApi
{
    // /run/tiha-mon/php: FPM havuzunun ("nobody") yazabildiği tek alt dizin (bkz. services/php-fpm.sh).
    private const STATE_FILE = '/run/tiha-mon/php/sysstat-prev.json';
    // Önceki örnek bundan daha eskiyse oran hesaplanmaz (sayfa yeni açıldı ya da uzun duraklama).
    private const MAX_GAP_SECONDS = 10.0;

    public function stats(): array
    {
        $now = microtime(true);
        $cpuUsec = self::readCpuUsec();
        $mem = self::readMemory();
        $io = self::readDiskIo();
        $net = self::readNetwork();

        $prev = self::readPrevState();
        $elapsed = $prev !== null ? $now - $prev['t'] : null;
        $valid = $elapsed !== null && $elapsed > 0 && $elapsed <= self::MAX_GAP_SECONDS;

        $result = [
            'mem_used_mb' => round($mem['used'] / 1048576, 1),
            'mem_total_mb' => $mem['total'] !== null ? round($mem['total'] / 1048576, 1) : null,
            'mem_percent' => $mem['total'] ? round($mem['used'] / $mem['total'] * 100, 1) : null,
            'cpu_percent' => null,
            'disk_read_mbps' => null,
            'disk_write_mbps' => null,
            'net_rx_mbit' => null,
            'net_tx_mbit' => null,
        ];

        if ($valid) {
            // cpu.stat mikrosaniye cinsinden; nproc() çekirdeğe göre normalize edilip 0-100 aralığına getirilir.
            $result['cpu_percent'] = round(
                ($cpuUsec - $prev['cpu_usec']) / 1_000_000 / $elapsed / max(1, self::nproc()) * 100, 1
            );
            $result['disk_read_mbps'] = round(max(0, $io['rbytes'] - $prev['io_rbytes']) / 1048576 / $elapsed, 2);
            $result['disk_write_mbps'] = round(max(0, $io['wbytes'] - $prev['io_wbytes']) / 1048576 / $elapsed, 2);
            $result['net_rx_mbit'] = round(max(0, $net['rx'] - $prev['net_rx']) * 8 / 1_000_000 / $elapsed, 2);
            $result['net_tx_mbit'] = round(max(0, $net['tx'] - $prev['net_tx']) * 8 / 1_000_000 / $elapsed, 2);
        }

        self::writeState([
            't' => $now, 'cpu_usec' => $cpuUsec,
            'io_rbytes' => $io['rbytes'], 'io_wbytes' => $io['wbytes'],
            'net_rx' => $net['rx'], 'net_tx' => $net['tx'],
        ]);

        return $result;
    }

    private static function readCpuUsec(): int
    {
        $s = @file_get_contents('/sys/fs/cgroup/cpu.stat');
        if ($s !== false && preg_match('/^usage_usec (\d+)/m', $s, $m)) {
            return (int) $m[1];
        }
        $v1 = @file_get_contents('/sys/fs/cgroup/cpuacct/cpuacct.usage'); // nanosaniye
        return $v1 !== false ? intdiv((int) trim($v1), 1000) : 0;
    }

    /** @return array{used:int, total:int|null} bayt */
    private static function readMemory(): array
    {
        $used = @file_get_contents('/sys/fs/cgroup/memory.current');
        if ($used === false) {
            $used = @file_get_contents('/sys/fs/cgroup/memory/memory.usage_in_bytes') ?: '0';
        }
        $maxRaw = trim((string) (@file_get_contents('/sys/fs/cgroup/memory.max') ?: ''));
        if ($maxRaw === '' || $maxRaw === 'max') {
            // Sınırsız (ya da okunamadı): host toplam belleği payda olarak kullanılır.
            $meminfo = @file_get_contents('/proc/meminfo') ?: '';
            $total = preg_match('/^MemTotal:\s+(\d+) kB/m', $meminfo, $m) ? ((int) $m[1]) * 1024 : null;
        } else {
            $total = (int) $maxRaw;
        }
        return ['used' => (int) trim((string) $used), 'total' => $total];
    }

    /** @return array{rbytes:int, wbytes:int} tüm aygıtların toplamı */
    private static function readDiskIo(): array
    {
        $s = @file_get_contents('/sys/fs/cgroup/io.stat');
        $rbytes = 0;
        $wbytes = 0;
        if ($s !== false) {
            foreach (explode("\n", trim($s)) as $line) {
                if (preg_match('/rbytes=(\d+)/', $line, $m)) {
                    $rbytes += (int) $m[1];
                }
                if (preg_match('/wbytes=(\d+)/', $line, $m)) {
                    $wbytes += (int) $m[1];
                }
            }
        }
        return ['rbytes' => $rbytes, 'wbytes' => $wbytes];
    }

    /** @return array{rx:int, tx:int} gerçek arabirimlerin (lo/docker/br-/veth hariç) toplamı */
    private static function readNetwork(): array
    {
        $s = @file_get_contents('/proc/net/dev') ?: '';
        $rx = 0;
        $tx = 0;
        foreach (explode("\n", $s) as $line) {
            if (!str_contains($line, ':')) {
                continue;
            }
            [$iface, $rest] = explode(':', $line, 2);
            $iface = trim($iface);
            if ($iface === 'lo' || preg_match('/^(docker|br-|veth|cni|flannel)/', $iface)) {
                continue;
            }
            $fields = preg_split('/\s+/', trim($rest));
            if (count($fields) >= 9) {
                $rx += (int) $fields[0];
                $tx += (int) $fields[8];
            }
        }
        return ['rx' => $rx, 'tx' => $tx];
    }

    private static function nproc(): int
    {
        static $n = null;
        if ($n === null) {
            $n = max(1, substr_count((string) @file_get_contents('/proc/cpuinfo'), "\nprocessor\t:"));
        }
        return $n;
    }

    private static function readPrevState(): ?array
    {
        $raw = @file_get_contents(self::STATE_FILE);
        if ($raw === false) {
            return null;
        }
        $data = json_decode($raw, true);
        return is_array($data) ? $data : null;
    }

    private static function writeState(array $state): void
    {
        // En kötü durumda (yazma başarısız) bir sonraki istek yalnız oranı atlar; kritik değil.
        @file_put_contents(self::STATE_FILE, json_encode($state), LOCK_EX);
    }
}
