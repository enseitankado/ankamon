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

use Ankamon\Core\Auth;
use Ankamon\Core\Db;
use Ankamon\Core\Request;
use Ankamon\Core\Settings;

/**
 * Genel bakış ▸ "Öneriler" (kullanıcı isteği 2026-11-24): kullanıcıya gerektiğinde bilgi vermek için tek yer. Her kural
 * ayrı bir işlev (RULES); koşulu tutan kural bir öneri döndürür, tutmayan null. Yeni öneri eklemek = RULES'a bir satır +
 * aynı adlı işlev. Arayüz (page.Dashboard __renderRecommendations) öneriyi düzey rengiyle listeler, "action"a göre düğme koyar.
 *
 * Öneri: {key, level: warn|info, title, text, count?, devices?: [{id, label, hostname, ip, online, os_family}],
 *         action?: {type: settings|ready|enroll|page, label, …}}
 *  - settings: Sistem ▸ Ayarlar'ın sekmesini açar {tab}
 *  - ready: hazır işlemi devices için Komut çalıştır penceresinde seçili açar {id}
 *  - enroll: Ankamon'a katılım komutu penceresi (ui.devices.EnrollDialog)
 *  - page: sayfa açar {page, tab?}
 * Yetki: önerinin işlemi kullanıcının yetkisinde değilse öneri gösterilmez (ör. Cihaz erişimi yalnız yönetici).
 */
final class RecommendationsApi
{
    private const RULES = ['accessPassword', 'unmanagedComputers', 'noSensorData', 'wakeOnLanOff'];
    /** Yönetilebilir: SSH ile oturum açılabiliyor ve yoklama taze (DevicesApi "manageable" ile aynı). */
    private const MANAGEABLE = "b.ssh_ok AND b.session_checked_at > now() - interval '3 minutes'";

    public function index(Request $request, array $user): array
    {
        $out = [];
        foreach (self::RULES as $rule) {
            $item = $this->{$rule}($user);
            if ($item !== null) {
                $out[] = ['key' => $rule] + $item;
            }
        }
        return ['items' => $out, 'at' => time()];
    }

    /** Önşart: cihazlara erişim (ve katılım betiği) için Cihaz erişimi parolası tanımlı olmalı. */
    private function accessPassword(array $user): ?array
    {
        if (!$user['is_admin'] || (Settings::get('ssh_access')['password'] ?? '') !== '') {
            return null;
        }
        return [
            'level' => 'warn',
            'title' => 'Cihaz erişimi parolası tanımlı değil',
            'text' => "Ankamon cihazlara SSH ile bu parolayla bağlanır; tanımlanmadan cihazlar yönetilemez ve yönetilemeyen " .
                'cihazlar için katılım komutu üretilemez. Önce bunu tanımlayın.',
            'action' => ['type' => 'settings', 'tab' => 'Cihaz erişimi', 'label' => 'Cihaz erişimini aç'],
        ];
    }

    /**
     * Ağda görünen (son 24 saat) bilgisayar/akıllı tahta türündeki varlıklardan cihaz kaydı olmayan ya da kaydı olup
     * SSH ile yönetilemeyenler: katılım komutuyla (OpenSSH + root parolası) tam entegre olurlar.
     */
    private function unmanagedComputers(array $user): ?array
    {
        if (!Auth::can($user, 'devices.manage')) {
            return null;
        }
        $rows = Db::all(
            "SELECT DISTINCT ON (n.mac) n.mac::text AS mac, host(n.ip) AS ip,
                    COALESCE(NULLIF(n.label, ''), NULLIF(n.hostname, ''), host(n.ip), n.mac::text) AS label, n.os_guess, n.online
               FROM net_devices n
              WHERE n.last_seen_at > now() - interval '24 hours'
                AND COALESCE(NULLIF(n.device_type, ''), n.type_auto) IN ('Bilgisayar', 'Akıllı tahta')
                -- Cihaz kaydı olup SSH'le en az bir kez erişilmiş (donanım bilgisi SSH'le toplanır) cihaz şu an kapalı
                -- olsa da yönetilebilir sayılır.
                AND NOT EXISTS (SELECT 1 FROM devices b WHERE (b.mac = n.mac OR b.wifi_mac = n.mac)
                                  AND (b.ssh_ok OR b.facts->>'cpu_model' IS NOT NULL))
              ORDER BY n.mac, n.last_seen_at DESC"
        );
        if (!$rows) {
            return null;
        }
        usort($rows, fn($a, $b) => [(int) !$a['online'], $a['label']] <=> [(int) !$b['online'], $b['label']]);
        return [
            'level' => 'info',
            'title' => count($rows) . ' bilgisayar ağda görünüyor ama Ankamon yönetemiyor',
            'text' => 'Bu bilgisayarlarda SSH erişimi yok. Bilgisayarda tek bir komut çalıştırmak yeterli: komut Ankamon\'dan ' .
                'süreli bir betik çeker, OpenSSH\'i kurar ve root parolasını Cihaz erişimi\'ndeki parola yapar; cihaz kendini ' .
                'Ankamon\'a bildirir.',
            'count' => count($rows),
            'assets' => array_map(fn($r) => ['label' => $r['label'], 'ip' => $r['ip'], 'mac' => $r['mac'],
                'os' => $r['os_guess'], 'online' => (bool) $r['online']], array_slice($rows, 0, 200)),
            'action' => ['type' => 'enroll', 'label' => 'Katılım komutunu al…'],
        ];
    }

    /** Yönetilebilir ama sensör verisi (node_exporter) gelmeyen cihazlar → "Metrik izlemeyi kur" hazır işlemi. */
    private function noSensorData(array $user): ?array
    {
        if (!Auth::can($user, 'actions')) {
            return null;
        }
        $devices = self::devices("NOT b.exporter_ok");
        if (!$devices) {
            return null;
        }
        return [
            'level' => 'warn',
            'title' => count($devices) . ' yönetilebilir cihazdan sensör verisi gelmiyor',
            'text' => 'SSH ile erişilebiliyor ama sensör (sıcaklık, CPU, disk…) verisi toplanamıyor: cihazda metrik izleme ' .
                '(node_exporter) kurulu değil ya da çalışmıyor. Sağlık uyarıları ve Sensörler sayfası bu cihazlarda boş kalır.',
            'count' => count($devices),
            'devices' => $devices,
            'action' => ['type' => 'ready', 'id' => 'node-exporter', 'label' => 'Metrik izlemeyi kur…'],
        ];
    }

    /**
     * Uzaktan uyandırması (Wake-on-LAN) etkin olmayan yönetilebilir cihazlar: donanım bilgisi (worker hwfacts ETH_WOL —
     * kablolu kartın ethtool "Wake-on" değeri; "g" yoksa sihirli paketle uyanmaz). ethtool yoksa (bilgi yok) sayılmaz;
     * facts.wol_service (her açılışta yeniden açan servis) arayüzde ipucu içindir.
     */
    private function wakeOnLanOff(array $user): ?array
    {
        if (!Auth::can($user, 'actions')) {
            return null;
        }
        $devices = self::devices(
            "b.facts->>'eth_wol' IS NOT NULL AND position('g' IN COALESCE(b.facts->>'eth_wol', '')) = 0
             AND COALESCE(device_os_family(b.id), 'linux') = 'linux'"
        );
        if (!$devices) {
            return null;
        }
        return [
            'level' => 'info',
            'title' => count($devices) . ' cihazda uzaktan uyandırma (Wake-on-LAN) etkin değil',
            'text' => 'Bu cihazlar kapalıyken Ankamon\'dan (ya da zamanlanmış görevle) açılamaz. "Uzaktan uyandırmayı etkinleştir" ' .
                'ağ kartında sihirli paketle uyandırmayı açar ve her açılışta yeniden uygular. BIOS\'ta da "Wake on LAN" açık, ' .
                '"ErP/Deep Sleep" kapalı olmalıdır.',
            'count' => count($devices),
            'devices' => $devices,
            'action' => ['type' => 'ready', 'id' => 'wake-on-lan', 'label' => 'Uzaktan uyandırmayı etkinleştir…'],
        ];
    }

    /** Yönetilebilir cihazlardan koşula uyanlar (arayüzün Komut çalıştır penceresine verebileceği biçimde). */
    private static function devices(string $where): array
    {
        return array_map(fn($r) => ['id' => (int) $r['id'], 'label' => $r['label'], 'hostname' => $r['hostname'],
            'ip' => $r['ip'], 'online' => true, 'os_family' => $r['os_family']], Db::all(
            "SELECT b.id, COALESCE(NULLIF(b.label, ''), b.hostname, host(b.ip)) AS label, b.hostname, host(b.ip) AS ip,
                    device_os_family(b.id) AS os_family
               FROM devices b WHERE " . self::MANAGEABLE . " AND ($where) ORDER BY 2"
        ));
    }
}
