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
use Ankamon\Core\Settings;
use Ankamon\Core\Storage;

/** Tahta envanteri. Kayıtlar çoğunlukla worker tarafından (log göndereni / ağ taraması) kendiliğinden oluşur. */
final class BoardsApi
{
    // facts'in disk/UEFI ayrıntıları (tahta başına ~20 KB — bkz. worker executor/hwfacts.py _DETAIL_FIELDS)
    // listeye konmaz: grid her yenilemede bunları taşımasın; Bilgi kartı "facts" görevinden okur.
    // mac = KABLOLU kartın MAC'i (tahtanın kimliği, WoL, ağ taraması — sütun adı tarihsel), wifi_mac = Wi-Fi kartının
    // kalıcı MAC'i (göç 043; worker oturum yoklaması/donanım bilgisi yazar, elle de girilebilir).
    private const COLUMNS = "b.id, b.hostname, b.mac::text AS mac, b.wifi_mac::text AS wifi_mac, host(b.ip) AS ip, b.label, b.location, b.notes,
        b.source, b.monitor_enabled, b.smart_board, b.exporter_port, b.online,
        b.ssh_ok, b.exporter_ok, b.facts - '{disk_layout,firmware_boot,uefi_vars}'::text[] AS facts, b.etap,
        b.session_username, b.session_locked, extract(epoch FROM b.session_checked_at)::bigint AS session_checked_at,
        -- Ekran kutucuğunda 'Oturumu açık kullanıcı yok (23 dk)': tahta açık ve taze yoklama (5 dk, no_login
        -- anomalisiyle aynı) oturum görmüyorsa, oturumsuz durumun başı = tahtanın son açık aralığının başı
        -- (board_uptime) ile son biten oturumun bitişinin geç olanı. Bilinmiyorsa null.
        CASE WHEN b.online AND b.session_username IS NULL AND b.session_checked_at > now() - interval '5 minutes'
             THEN extract(epoch FROM GREATEST(
                 (SELECT max(u.started_at) FROM board_uptime u WHERE lower(u.host) = lower(b.hostname)),
                 (SELECT max(s.ended_at) FROM board_sessions s WHERE s.board_id = b.id)))::bigint
        END AS no_session_since,
        b.display_state, b.netifs, b.autoshutdown, b.screen_locked, array_to_json(b.input_locks) AS input_locks,
        (SELECT r.source_board_id FROM screen_relays r WHERE r.target_board_id = b.id) AS relay_source,
        EXISTS (SELECT 1 FROM screen_relays r WHERE r.source_board_id = b.id) AS relay_is_source,
        extract(epoch FROM b.last_seen_at)::bigint AS last_seen_at,
        extract(epoch FROM GREATEST(b.last_log_at, rl.at))::bigint AS last_log_at,
        -- Kablo için logdan kanıt (Tahtalar ▸ Kablo, oturum yoklaması yokken/eskiyken): son 2 dk'da tahtanın IP'sinden
        -- log geldi VE ağ taramasının o IP için gördüğü MAC tahtanın kablolu kartının MAC'i (bkz. netifs) → loglar
        -- kablolu karttan, yerel kablolu ağdan geliyor.
        (rl.ip_log AND EXISTS (
            SELECT 1 FROM net_devices d, jsonb_array_elements(b.netifs->'ifaces') i
            WHERE i->>'kind' = 'ethernet' AND d.ip = b.ip AND lower(d.mac::text) = lower(i->>'mac')
        )) AS cable_log,
        -- KALICI KURAL (kullanıcı 2026-11-10): Akıllı Tahtalar Varlıklar'ın alt kümesi; «Çevrimiçi» = cihaz ağda canlı
        -- (Varlıklar'la aynı ölçü: ağ taraması tahtanın kablolu/kablosuz MAC'ini çevrim içi görüyor) — SSH'e bağlı değil.
        -- SSH/sensör portu erişimi (b.online) ayrı: arayüzde «Yönetilebilir». SSH yanıt veriyorsa cihaz da canlıdır (ARP
        -- turları arasında net_devices gecikebilir), bu yüzden alive = online OR net_online.
        EXISTS (SELECT 1 FROM net_devices nd WHERE (nd.mac = b.mac OR nd.mac = b.wifi_mac) AND nd.online) AS net_online,
        (b.online OR EXISTS (SELECT 1 FROM net_devices nd WHERE (nd.mac = b.mac OR nd.mac = b.wifi_mac) AND nd.online)) AS alive,
        -- «Yönetilebilir» = SSH ile OTURUM açılabiliyor (kullanıcı bildirimi 2026-11-10: SSH portu açık ama root parolası
        -- tutmayan tahta «Evet» görünüyordu): son 3 dakikada başarılı oturum yoklaması (worker tasks/session_probe — 30 sn'de
        -- bir SSH ile giriş yapar). Yoklanmayan tahtada (sensör toplama kapalı) port durumu (b.online).
        COALESCE(b.online AND (NOT b.monitor_enabled OR b.session_checked_at > now() - interval '3 minutes'), false) AS manageable,
        COALESCE((b.ssh_ok AND b.monitor_enabled AND (b.session_checked_at IS NULL OR b.session_checked_at < now() - interval '3 minutes')), false)
            AS ssh_login_failing";

    /**
     * boards + "şu anda log mu geliyor" (rl) — yalnız last_log_at'i hemen göstermek için (bir tahta
     * log göndermeye başladığında, worker'ın last_log_at'i yazmasını beklemeden). "online" bilerek
     * buna bakmaz, yalnız board_status'ın yoklamasına (ssh_ok/exporter_ok, en hızlı STATUS_TICK_SECONDS'ta
     * bir güncellenir — bkz. worker/__main__.py) dayanır: SSH/sensör portu asıl erişilebilirlik,
     * log akışı tek başına yeterli değil (ör. kuyruğa birikmiş eski loglar yanlışlıkla "çevrimiçi"
     * gösterebilirdi). logs_host_time_idx (host, received_at DESC) bu sorguyu indeksli tutar.
     */
    private const FROM = "FROM boards b LEFT JOIN LATERAL (
        SELECT max(received_at) AS at, bool_or(from_ip = host(b.ip)) AS ip_log FROM logs
        WHERE received_at > now() - interval '2 minutes'
          AND (lower(host) = lower(b.hostname) OR from_ip = host(b.ip))
    ) rl ON true";

    /** Ağ ▸ Varlıklar'daki türün tahta karşılığı (bkz. worker netscan/classify.py BOARD). */
    private const BOARD_TYPE = 'Akıllı tahta';

    /**
     * Ağ ▸ Akıllı Tahtalar listesi Ağ ▸ Varlıklar'dan belirlenir (kullanıcı isteği 2026-11-10): tahta, MAC'i (kablolu
     * ya da kablosuz) Varlıklar'da türü "Akıllı tahta" olan bir satıra düşüyorsa listededir; Varlıklar'da türü başka
     * bir şeye çevrilirse listeden kendiliğinden çıkar (kayıt, geçmişi/oturumları için silinmez — tür geri alınınca
     * döner). Varlıklar'da henüz hiç görülmemiş kayıt (elle eklenmiş, ağda henüz taranmamış tahta) listede kalır.
     * Varlıklar'da türü "Akıllı tahta" olup kaydı olmayan cihaza kayıt worker'da açılır (netscan store.boards_from_devices).
     */
    private const LISTED = "(EXISTS (SELECT 1 FROM net_devices d WHERE d.mac IN (b.mac, b.wifi_mac)
            AND COALESCE(NULLIF(d.device_type, ''), d.type_auto) = '" . self::BOARD_TYPE . "')
        OR NOT EXISTS (SELECT 1 FROM net_devices d WHERE d.mac IN (b.mac, b.wifi_mac)))";

    public function index(): array
    {
        $boards = Db::all('SELECT ' . self::COLUMNS . ' ' . self::FROM . ' WHERE ' . self::LISTED . ' ORDER BY b.label, b.hostname, b.ip');
        return ['boards' => array_map(self::boardRowForPanel(...), $boards)];
    }

    public function show(Request $request): array
    {
        $board = Db::one('SELECT ' . self::COLUMNS . ' ' . self::FROM . ' WHERE b.id = ?', [$request->arg('id')])
            ?? throw ApiError::notFound();
        return ['board' => self::boardRowForPanel($board)];
    }

    public function create(Request $request, array $user): array
    {
        $fields = self::validatedBoardFields($request);
        // Takma ad ve kablolu MAC zorunlu (Tahta ekle penceresi): kablolu MAC tahtayı ağ taramasında bulur ve uzaktan
        // uyandırmayı sağlar (WoL kablolu kartla; Wi-Fi WoL tahtalarda genelde çalışmaz); kablosuz MAC isteğe bağlı.
        // Bilgisayar adı elle girilmez (loglardan / donanım bilgisinden öğrenilir).
        if (($fields['label'] ?? '') === '') {
            throw ApiError::badRequest('Takma ad gerekli.');
        }
        if (empty($fields['mac'])) {
            throw ApiError::badRequest('Kablolu MAC adresi gerekli (de:ad:de:ad:de:ad).');
        }
        if (Db::value('SELECT 1 FROM boards WHERE mac = ?', [$fields['mac']])) {
            throw ApiError::badRequest('Bu kablolu MAC adresiyle kayıtlı bir tahta zaten var.');
        }
        // IP girilmediyse ağ taramasının bu MAC için bildiği adres — önce kablolu, yoksa kablosuz MAC (yoksa tarama
        // sonunda dolar — bkz. worker netscan/store.py fill_board_ips).
        if (empty($fields['ip'])) {
            $fields['ip'] = Db::value(
                'SELECT host(ip) FROM net_devices WHERE (mac = ? OR mac = ?) AND ip IS NOT NULL
                  ORDER BY mac = ? DESC, last_seen_at DESC NULLS LAST LIMIT 1',
                [$fields['mac'], $fields['wifi_mac'] ?? $fields['mac'], $fields['mac']]
            );
        }
        $fields['source'] = 'manual';
        $columns = array_keys($fields);
        $id = Db::value(
            'INSERT INTO boards (' . implode(', ', $columns) . ') VALUES (' . implode(', ', array_fill(0, count($columns), '?')) . ') RETURNING id',
            array_values($fields)
        );
        // Tahta ekle = "bu cihaz akıllı tahtadır": Varlıklar'da bu MAC'lerle görülmüş cihazın türü başka bir şeyse
        // "Akıllı tahta" yapılır — yoksa liste (LISTED) yeni kaydı hemen gizlerdi.
        Db::exec(
            "UPDATE net_devices SET device_type = ? WHERE mac IN (?, ?) AND COALESCE(NULLIF(device_type, ''), type_auto) <> ?",
            [self::BOARD_TYPE, $fields['mac'], $fields['wifi_mac'] ?? $fields['mac'], self::BOARD_TYPE]
        );
        Audit::log($user, $request, 'board.create', $fields['label'] . ' ' . $fields['mac']);
        return ['id' => $id];
    }

    public function update(Request $request, array $user): array
    {
        $id = $request->arg('id');
        Db::value('SELECT 1 FROM boards WHERE id = ?', [$id]) ?? throw ApiError::notFound();
        $fields = self::validatedBoardFields($request);
        if ($fields) {
            $sets = implode(', ', array_map(static fn($column) => "$column = ?", array_keys($fields)));
            Db::exec("UPDATE boards SET $sets, updated_at = now() WHERE id = ?", [...array_values($fields), $id]);
            Audit::log($user, $request, 'board.update', (string) $id, ['fields' => array_keys($fields)]);
        }
        return ['ok' => true];
    }

    /**
     * Tahtayı, loglarını ve sensör geçmişini TAMAMEN siler (geri alınamaz). `logs` tablosunda
     * board_id yoktur; ilişki yalnız hostname eşleşmesiyle kurulur (bkz. sınıf başı not). Silinen
     * tahta engellenmez (kullanıcı isteği, 2026-10-22): hâlâ log gönderiyorsa worker
     * (boards_from_logs) kaydı kendiliğinden yeniden açar.
     */
    public function delete(Request $request, array $user): array
    {
        $id = $request->arg('id');
        $board = Db::one('SELECT hostname FROM boards WHERE id = ?', [$id]) ?? throw ApiError::notFound();

        // logs/metrics sıkıştırılmış chunk'larda durur; düz DELETE açma sınırına takılır (bkz. Storage).
        [$logsDeleted, $metricsDeleted] = Storage::delete([
            empty($board['hostname'])
                ? ['DELETE FROM logs WHERE false', []]
                : ['DELETE FROM logs WHERE lower(host) = lower(?)', [$board['hostname']]],
            ['DELETE FROM metrics WHERE tag_id IN (SELECT tag_id FROM metrics_tag WHERE board_id = ?)', [(string) $id]],
            ['DELETE FROM metrics_tag WHERE board_id = ?', [(string) $id]],
            ['DELETE FROM boards WHERE id = ?', [$id]],
        ]);
        Audit::log($user, $request, 'board.delete', (string) $id);
        return ['ok' => true, 'logs_deleted' => $logsDeleted, 'metrics_deleted' => $metricsDeleted];
    }

    /**
     * Web terminal bağlantı bilgisi (yalnız "shell" yetkisi). Parola URL'de base64 taşınacağından
     * webssh'in beklediği biçimde kodlanır. Oturum açılışı komut loguna işlenir.
     */
    public function shell(Request $request, array $user): array
    {
        $board = Db::one(
            "SELECT id, host(ip) AS ip, COALESCE(NULLIF(label,''), hostname, host(ip)) AS name FROM boards WHERE id = ?",
            [$request->arg('id')]
        ) ?? throw ApiError::notFound();
        if (empty($board['ip'])) {
            throw ApiError::badRequest('Bu tahtanın IP adresi yok; web terminal açılamaz.');
        }
        $access = Settings::get('ssh_access');
        if (($access['password'] ?? '') === '') {
            throw ApiError::badRequest('SSH parolası tanımlı değil (Ayarlar → SSH erişimi).');
        }

        Db::exec(
            "INSERT INTO command_log (board_id, board_name, username, source, command, status)
             VALUES (?, ?, ?, 'webshell', 'web terminal oturumu açıldı', 'ok')",
            [$board['id'], $board['name'], $user['username']]
        );
        // Oturumlar sayfası için bekleyen oturum: webssh kancası bağlantı kurulunca başlangıcını,
        // kapanınca bitişini yazar (bkz. db/migrations/011_webshell_sessions.sql).
        Db::exec(
            'INSERT INTO webshell_sessions (board_id, board_name, username, ip) VALUES (?, ?, ?, ?)',
            [$board['id'], $board['name'], $user['username'], $board['ip']]
        );
        Audit::log($user, $request, 'board.shell', $board['name']);

        return [
            'hostname' => $board['ip'],
            'port' => 22,
            'username' => $access['user'] ?: 'root',
            // webssh URL parametresinde parolayı base64 bekler.
            // Tahtaya özel root parolası varsa o (bkz. worker executor/board_password.py).
            'password' => base64_encode((string) (Db::value(
                'SELECT root_password FROM board_credentials WHERE board_id = ?', [$board['id']]
            ) ?: $access['password'])),
        ];
    }

    /**
     * Dosya yöneticisi bağlantı bilgisi (yalnız "filemanager" yetkisi) — açılış köprüsü
     * (/filemanager-open/) bununla tahtayı sshfs ile bağlar. Oturum açılışı, bağlama gerçekten
     * başarılı olunca komut loguna işlenir (bkz. worker/ankamon/filemanager) — burada değil,
     * başarısız denemeler log'u kirletmesin diye (screen() ile aynı desen).
     */
    public function filemanager(Request $request): array
    {
        $board = Db::one(
            "SELECT id, host(ip) AS ip FROM boards WHERE id = ?", [$request->arg('id')]
        ) ?? throw ApiError::notFound();
        if (empty($board['ip'])) {
            throw ApiError::badRequest('Bu tahtanın IP adresi yok; dosya yöneticisi açılamaz.');
        }
        if ((Settings::get('ssh_access')['password'] ?? '') === '') {
            throw ApiError::badRequest('SSH parolası tanımlı değil (Ayarlar → SSH erişimi).');
        }

        // Kimlik bilgisi bilerek DÖNMEZ: bağlama köprüsü (worker/ankamon/filemanager) onu kendisi
        // veritabanından okur. Tarayıcıya (iframe URL'si) giden root parolası "filemanager" yetkisini
        // fiilen "shell"e çeviriyordu.
        return [
            'board' => $board['id'],
            'hostname' => $board['ip'],
        ];
    }

    /** İstekte gelen, düzenlenebilir alanları doğrulayıp sütun → değer olarak döner. */
    private static function validatedBoardFields(Request $request): array
    {
        $fields = [];
        foreach (['label', 'location', 'notes', 'hostname'] as $key) {
            if ($request->has($key)) {
                $fields[$key] = mb_substr(trim((string) $request->input($key)), 0, $key === 'notes' ? 2000 : 120);
            }
        }
        if (($fields['hostname'] ?? null) === '') {
            $fields['hostname'] = null;
        }
        if ($request->has('ip')) {
            $ip = trim((string) $request->input('ip'));
            if ($ip !== '' && !filter_var($ip, FILTER_VALIDATE_IP)) {
                throw ApiError::badRequest('Geçersiz IP adresi.');
            }
            $fields['ip'] = $ip === '' ? null : $ip;
        }
        // mac: kablolu kartın MAC'i; wifi_mac: Wi-Fi kartının MAC'i (isteğe bağlı) — aynı biçim denetimi.
        foreach (['mac' => 'Kablolu', 'wifi_mac' => 'Kablosuz'] as $key => $kind) {
            if ($request->has($key)) {
                $mac = strtolower(trim((string) $request->input($key)));
                if ($mac !== '' && !preg_match('/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/', $mac)) {
                    throw ApiError::badRequest("Geçersiz $kind MAC adresi: de:ad:de:ad:de:ad biçiminde olmalı.");
                }
                $fields[$key] = $mac === '' ? null : $mac;
            }
        }
        if ($request->has('monitor_enabled')) {
            $fields['monitor_enabled'] = (bool) $request->input('monitor_enabled');
        }
        // "Bu bir akıllı tahtadır": MAC'i tahta MAC'i olmasa da tahta sayılır (bkz. migration 046, worker boards_from_logs).
        if ($request->has('smart_board')) {
            $fields['smart_board'] = (bool) $request->input('smart_board');
        }
        if ($request->has('exporter_port')) {
            $port = (int) $request->input('exporter_port');
            if ($port < 1 || $port > 65535) {
                throw ApiError::badRequest('Geçersiz port.');
            }
            $fields['exporter_port'] = $port;
        }
        return $fields;
    }

    private static function boardRowForPanel(array $board): array
    {
        $board['facts'] = json_decode((string) $board['facts'], true) ?: new \stdClass();
        // ETAP faz bilgisi (bkz. migration 018, worker netscan/etap_phase.py); yoksa null.
        $board['etap'] = isset($board['etap']) ? json_decode((string) $board['etap'], true) : null;
        // Ekranlar alt barı: ağ arabirimleri ve TiHA otomatik kapatma geri sayımı (bkz. migration 026); yoksa null.
        $board['netifs'] = isset($board['netifs']) ? json_decode((string) $board['netifs'], true) : null;
        $board['autoshutdown'] = isset($board['autoshutdown']) ? json_decode((string) $board['autoshutdown'], true) : null;
        $board['input_locks'] = json_decode((string) ($board['input_locks'] ?? '[]'), true) ?: [];
        return $board;
    }
}
