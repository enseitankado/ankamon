<?php
declare(strict_types=1);

namespace Tihamon\Api;

use Tihamon\Core\ApiError;
use Tihamon\Core\Audit;
use Tihamon\Core\Db;
use Tihamon\Core\Request;

/**
 * Ağ envanteri (sol menü "Ağ"): sunucunun bağlı olduğu fiziksel ağlar ve oralarda görülen bütün
 * cihazlar (çevrimdışı olanlar dahil). Kayıtların çoğunu tarayıcı açar — worker/tihamon/netscan;
 * şema db/migrations/015_network_inventory.sql. Cihaz kimliği MAC adresidir.
 *
 * Canlı güncelleme: arayüz state()'i birkaç saniyede bir okur; version değişmişse listeyi yeniden çeker.
 */
final class NetworkApi
{
    // Arayüzdeki tür listesi ile worker/tihamon/netscan/classify.py adları aynı tutulur (serbest metin de kabul edilir).
    private const TEXT_LIMITS = ['label' => 120, 'device_type' => 60, 'model' => 160, 'notes' => 2000, 'hostname' => 160];

    public function index(): array
    {
        $networks = Db::all(
            "SELECT n.id, n.cidr::text AS cidr, n.name, n.ifaces, host(n.local_ip) AS local_ip,
                    host(n.gateway) AS gateway, n.attached, n.scan_enabled, n.notes,
                    extract(epoch FROM n.last_scan_at)::bigint AS last_scan_at, n.last_scan_ms,
                    count(d.id) AS devices, count(d.id) FILTER (WHERE d.online) AS online
             FROM net_networks n LEFT JOIN net_devices d ON d.network_id = n.id
             GROUP BY n.id ORDER BY n.attached DESC, n.cidr"
        );
        foreach ($networks as &$network) {
            $network['ifaces'] = self::pgArray((string) $network['ifaces']);
        }
        unset($network);
        return ['networks' => $networks] + $this->state();
    }

    /** Ucuz yoklama: tarayıcının durumu + liste sürümü. */
    public function state(): array
    {
        $row = Db::one('SELECT version, state, extract(epoch FROM updated_at)::bigint AS updated_at FROM netscan_state WHERE id = 1');
        return [
            'version' => (int) ($row['version'] ?? 0),
            'state' => json_decode((string) ($row['state'] ?? '{}'), true) ?: new \stdClass(),
            'state_at' => (int) ($row['updated_at'] ?? 0),
            'now' => time(),
        ];
    }

    /** ?network=<id> (0/boş: tüm ağlar). Her cihaz kendi servis listesiyle döner. */
    public function devices(Request $request): array
    {
        $network = $request->queryInt('network', 0, 0, PHP_INT_MAX);
        $state = $this->state();
        $devices = Db::all(
            "SELECT d.id, d.network_id, n.cidr::text AS network, d.mac::text AS mac, host(d.ip) AS ip, d.hostname,
                    d.label, d.vendor, COALESCE(NULLIF(d.device_type, ''), d.type_auto) AS device_type,
                    d.device_type AS device_type_manual, d.type_auto,
                    COALESCE(NULLIF(d.model, ''), d.model_auto) AS model, d.model AS model_manual, d.model_auto,
                    d.os_guess, d.notes, d.source, d.online, d.etap,
                    extract(epoch FROM d.first_seen_at)::bigint AS first_seen_at,
                    extract(epoch FROM d.last_seen_at)::bigint AS last_seen_at,
                    extract(epoch FROM d.state_changed_at)::bigint AS state_changed_at,
                    extract(epoch FROM d.services_scanned_at)::bigint AS services_scanned_at,
                    d.services_requested_at IS NOT NULL AS services_requested,
                    b.id AS board_id, COALESCE(NULLIF(b.label, ''), b.hostname) AS board_name,
                    COALESCE((SELECT json_agg(json_build_object('proto', s.proto, 'port', s.port, 'service', s.service,
                                  'product', s.product, 'version', s.version, 'extra', s.extra) ORDER BY s.port, s.proto)
                              FROM net_services s WHERE s.device_id = d.id), '[]') AS services
             FROM net_devices d
             JOIN net_networks n ON n.id = d.network_id
             LEFT JOIN boards b ON b.mac = d.mac
             WHERE (? = 0 OR d.network_id = ?)
             ORDER BY d.ip NULLS LAST, d.mac",
            [$network, $network]
        );
        foreach ($devices as &$device) {
            $device['services'] = json_decode((string) $device['services'], true) ?: [];
        }
        unset($device);
        // ETAP faz bilgisi (bkz. migration 018, worker netscan/etap_phase.py); yoksa null.
        $devices = array_map(static fn(array $d) => ['etap' => $d['etap'] === null ? null : json_decode((string) $d['etap'], true)] + $d, $devices);
        return ['devices' => $devices] + $state;
    }

    public function createDevice(Request $request, array $user): array
    {
        $mac = self::mac((string) $request->input('mac', ''));
        $fields = self::fields($request);
        $networkId = (int) $request->input('network_id', 0);
        // Ağ seçilmediyse IP'yi içeren ağ bulunur.
        if ($networkId === 0 && !empty($fields['ip'])) {
            $networkId = (int) Db::value('SELECT id FROM net_networks WHERE ?::inet << cidr ORDER BY masklen(cidr) DESC LIMIT 1', [$fields['ip']]);
        }
        if ($networkId === 0 || Db::value('SELECT 1 FROM net_networks WHERE id = ?', [$networkId]) === null) {
            throw ApiError::badRequest('Cihazın ekleneceği ağ seçilmedi (IP adresi de bilinen bir ağa ait değil).');
        }
        if (Db::value('SELECT 1 FROM net_devices WHERE network_id = ? AND mac = ?::macaddr', [$networkId, $mac]) !== null) {
            throw ApiError::badRequest('Bu MAC adresiyle bu ağda zaten bir cihaz kayıtlı.');
        }
        $fields += ['network_id' => $networkId, 'mac' => $mac, 'source' => 'manual'];
        $columns = array_keys($fields);
        $id = Db::value(
            'INSERT INTO net_devices (' . implode(', ', $columns) . ') VALUES (' . implode(', ', array_fill(0, count($columns), '?')) . ') RETURNING id',
            array_values($fields)
        );
        self::changed();
        Audit::log($user, $request, 'network.device.create', $mac);
        return ['id' => $id];
    }

    public function updateDevice(Request $request, array $user): array
    {
        $id = $request->arg('id');
        Db::value('SELECT 1 FROM net_devices WHERE id = ?', [$id]) ?? throw ApiError::notFound();
        $fields = self::fields($request);
        if ($fields) {
            $sets = implode(', ', array_map(static fn($c) => "$c = ?", array_keys($fields)));
            Db::exec("UPDATE net_devices SET $sets WHERE id = ?", [...array_values($fields), $id]);
            self::changed();
            Audit::log($user, $request, 'network.device.update', (string) $id, ['fields' => array_keys($fields)]);
        }
        return ['ok' => true];
    }

    /** Gövde: {ids:[…]}. Cihaz yeniden görülürse tarayıcı onu yeni kayıt olarak ekler. */
    public function deleteDevices(Request $request, array $user): array
    {
        $ids = self::ids($request->input('ids'));
        $n = Db::exec('DELETE FROM net_devices WHERE id = ANY(?::int[])', ['{' . implode(',', $ids) . '}']);
        self::changed();
        Audit::log($user, $request, 'network.device.delete', implode(',', $ids));
        return ['ok' => true, 'deleted' => $n];
    }

    /** Ağın adı/notu/taramaya açık olup olmadığı. */
    public function updateNetwork(Request $request, array $user): array
    {
        $id = $request->arg('id');
        Db::value('SELECT 1 FROM net_networks WHERE id = ?', [$id]) ?? throw ApiError::notFound();
        $sets = [];
        $args = [];
        foreach (['name' => 120, 'notes' => 2000] as $key => $limit) {
            if ($request->has($key)) {
                $sets[] = "$key = ?";
                $args[] = mb_substr(trim((string) $request->input($key)), 0, $limit);
            }
        }
        if ($request->has('scan_enabled')) {
            $sets[] = 'scan_enabled = ?';
            $args[] = $request->input('scan_enabled') ? 'true' : 'false';
        }
        if ($sets) {
            Db::exec('UPDATE net_networks SET ' . implode(', ', $sets) . ' WHERE id = ?', [...$args, $id]);
            self::changed();
            Audit::log($user, $request, 'network.update', (string) $id);
        }
        return ['ok' => true];
    }

    /** Yalnız artık bağlı olmayan ağ (kayıtlarıyla birlikte) silinir; bağlı ağ bir sonraki taramada geri gelirdi. */
    public function deleteNetwork(Request $request, array $user): array
    {
        $id = $request->arg('id');
        $network = Db::one('SELECT cidr::text AS cidr, attached FROM net_networks WHERE id = ?', [$id]) ?? throw ApiError::notFound();
        if ($network['attached']) {
            throw ApiError::badRequest('Sunucu bu ağa hâlâ bağlı; silinemez (taramayı kapatabilirsiniz).');
        }
        Db::exec('DELETE FROM net_networks WHERE id = ?', [$id]);
        self::changed();
        Audit::log($user, $request, 'network.delete', $network['cidr']);
        return ['ok' => true];
    }

    /**
     * Gövde: {} → bütün ağları hemen tara; {services: [cihaz id…]} → bu cihazların servislerini
     * sıranın başında tara (makine orta yükteyken de; çok yoğunsa yine ertelenir).
     */
    public function scan(Request $request, array $user): array
    {
        if ($request->has('services')) {
            $ids = self::ids($request->input('services'));
            Db::exec('UPDATE net_devices SET services_requested_at = now() WHERE id = ANY(?::int[])', ['{' . implode(',', $ids) . '}']);
            Db::exec("SELECT pg_notify('tihamon_netscan', 'services')");
            self::changed();
            Audit::log($user, $request, 'network.scan.services', implode(',', $ids));
        } else {
            Db::exec("SELECT pg_notify('tihamon_netscan', 'sweep')");
        }
        return ['ok' => true];
    }

    private static function changed(): void
    {
        Db::exec('UPDATE netscan_state SET version = version + 1 WHERE id = 1');
    }

    /** @return list<int> */
    private static function ids(mixed $value): array
    {
        if (!is_array($value) || !$value || count($value) > 5000) {
            throw ApiError::badRequest('Cihaz seçilmedi.');
        }
        $ids = [];
        foreach ($value as $id) {
            if (!is_int($id) && !(is_string($id) && ctype_digit($id))) {
                throw ApiError::badRequest('Geçersiz cihaz kimliği.');
            }
            $ids[] = (int) $id;
        }
        return $ids;
    }

    private static function mac(string $mac): string
    {
        $mac = strtolower(str_replace('-', ':', trim($mac)));
        if (!preg_match('/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/', $mac)) {
            throw ApiError::badRequest('Geçerli bir MAC adresi gerekli (ör. 00:1a:2b:3c:4d:5e).');
        }
        return $mac;
    }

    /** Kullanıcının düzenleyebildiği alanlar. */
    private static function fields(Request $request): array
    {
        $fields = [];
        foreach (self::TEXT_LIMITS as $key => $limit) {
            if ($request->has($key)) {
                $fields[$key] = mb_substr(trim((string) $request->input($key)), 0, $limit);
            }
        }
        if ($request->has('ip')) {
            $ip = trim((string) $request->input('ip'));
            if ($ip !== '' && !filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) {
                throw ApiError::badRequest('Geçersiz IPv4 adresi.');
            }
            $fields['ip'] = $ip === '' ? null : $ip;
        }
        return $fields;
    }

    /** @return list<string> Postgres text[] metnini çözer ({eth0,eth1}). */
    private static function pgArray(string $value): array
    {
        $value = trim($value, '{}');
        return $value === '' ? [] : array_map(static fn($v) => trim($v, '"'), explode(',', $value));
    }
}
