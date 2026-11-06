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
 * Anomaliler (Tahtalar ▸ Anomaliler): worker'ın kurallarla ön hesapladığı sıra dışı durum aralıkları
 * (bkz. db/migrations/033_anomalies.sql, worker/ankamon/anomaly). İstek başına hesap yapılmaz.
 *
 * Yanıt: {"kinds": {tür: {label, description, scan, source, source_detail, every}}, "anomalies": [{id, kind, board_id, board, host,
 * started_at, ended_at|null, detail}], "computed_at", "last_scan_job"} — sürenlerin TÜMÜ + [from, to] aralığıyla
 * örtüşen bitmişler (epoch saniye). board: tahtanın güncel adı; tahta silindiyse kayıttaki ad.
 */
final class AnomaliesApi
{
    /**
     * level: bulgunun düzeyi (bad = Acil, warn = Dikkat — Bakım raporuyla aynı adlar; Tahta sağlığı ▸ Durum en kötüsünü gösterir).
     * Tür adları ve açıklamaları — arayüz metni tek yerde (worker yalnız kind yazar). scan: Anomaliler ▸
     * Tarama'da seçilen tahtalarda anlık taranabilir (kuralın PROBE'u var — bkz. worker anomaly/scan.py).
     * source/source_detail/every: otomatik tespitin veri kaynağı ve sıklığı (Anlık sekmesi). Otomatik tespit tahtaya
     * bağlanıp komut çalıştırmaz: worker 60 sn'lik turda kuralları Ankamon'daki veriden hesaplar, log tarayan
     * kurallar en çok 5 dk'da bir (EVERY). Kural ya da kaynağı değişirse burası da güncellenir.
     */
    private const KINDS = [
        'no_login' => [
            'label' => 'Oturumsuz açık',
            'description' => 'Tahta en az 15 dakikadır açık ve kimse oturum açmamış (açılıştan beri ya da son oturum kapandıktan sonra).',
            'level' => 'warn',
            'scan' => true,
            'source' => 'Log',
            'source_detail' => 'Tahtanın gönderdiği loglardan çıkarılan açık kalma ve oturum aralıkları (Ankamon bağlanmaz).',
            'every' => '60 sn',
        ],
        'ntp_unsynced' => [
            'label' => 'NTP eşitlenmemiş',
            'description' => 'Tahtanın saati en az 15 dakikadır NTP sunucusuyla eşitlenmiyor (eşitleme kapalı, sunucuya ulaşılamıyor) ya da saati Ankamon sunucusundan 30 sn\'den fazla sapıyor.',
            'level' => 'warn',
            'scan' => true,
            'source' => 'Ölçüm',
            'source_detail' => 'Ankamon\'un tahtanın 9100 portundan 60 sn\'de bir okuduğu saat ölçümleri (komut çalışmaz).',
            'every' => '60 sn',
        ],
        'cpu_temp_high' => [
            'label' => 'İşlemci sıcaklığı yüksek',
            'description' => 'İşlemci sıcaklığı en az 15 dakikadır tahtanın kendi ortalamasının %30 üzerinde (ortalama: son 30 günün saatlik ortalamaları; en az 24 saatlik geçmiş gerekir).',
            'level' => 'warn',
            'scan' => true,
            'source' => 'Ölçüm',
            'source_detail' => 'Ankamon\'un tahtanın 9100 portundan 60 sn\'de bir okuduğu sıcaklık ölçümleri (komut çalışmaz).',
            'every' => '60 sn',
        ],
        'disk_temp_high' => [
            'label' => 'Disk sıcaklığı yüksek',
            'description' => 'Disk sıcaklığı en az 15 dakikadır tahtanın kendi ortalamasının %30 üzerinde (ortalama: son 30 günün saatlik ortalamaları; en az 24 saatlik geçmiş gerekir).',
            'level' => 'warn',
            'scan' => true,
            'source' => 'Ölçüm',
            'source_detail' => 'Ankamon\'un tahtanın 9100 portundan 60 sn\'de bir okuduğu disk sıcaklığı ölçümleri (komut çalışmaz).',
            'every' => '60 sn',
        ],
        'net_link_lost' => [
            'label' => 'Ağ bağlantısı koptu',
            'description' => 'Tahta açıkken ağa ulaşamadı: ağ kablosu çıkarıldı ya da ağ anahtarı/port kesildi. Bağlantı gelince tahtanın kuyrukta bekletip geç gönderdiği loglardan geriye dönük saptanır (o sürede sensör verisi de alınamamış, başka tahtalar ise ulaşıyor olmalı). Tahta kabloyu kaybettiğini logla bildirdiyse "Ağ kablosu çıkarıldı" yazar. Tarama: kablonun şu anki durumu ve son 7 gündeki kopmalar.',
            'level' => 'bad',
            'scan' => true,
            'source' => 'Log',
            'source_detail' => 'Tahtanın loglarının geç ve toplu gelmesi (Ankamon bağlanmaz).',
            'every' => '5 dk',
        ],
        'log_delayed' => [
            'label' => 'Log iletimi gecikti',
            'description' => 'Tahtaya ulaşılabildiği halde (sensör verisi geliyordu) logları en az 10 dakika geç geldi: sorun log iletim yolunda — tahta log sunucusunun adını (istiklal.local) çözemedi, sunucunun log portu ya da tahtanın rsyslog\'u. Ağ bağlantısı kopukluğu ayrı türdür.',
            'level' => 'warn',
            'scan' => false,
            'source' => 'Log',
            'source_detail' => 'Tahtanın loglarının geç gelmesi (Ankamon bağlanmaz).',
            'every' => '5 dk',
        ],
        'ssh_bruteforce' => [
            'label' => 'SSH kaba kuvvet',
            'description' => 'Aynı kaynaktan en az 10 başarısız SSH girişi (aralarında 10 dakikadan uzun ara yok). Kaynak adres ve denenen hesaplar ayrıntıda; kaynak Ankamon\'un kendisi de olabilir (ayarlardaki parola tahtanınkinden farklıysa).',
            'level' => 'bad',
            'scan' => false,
            'source' => 'Log',
            'source_detail' => 'Tahtanın sshd logları: başarısız giriş satırları (Ankamon bağlanmaz).',
            'every' => '5 dk',
        ],
        'dhcp_issue' => [
            'label' => 'DHCP adres alamadı',
            'description' => 'Tahta bir ağ arabiriminde (kablolu ya da Wi-Fi) DHCP ile adres alamadı (15 dakika içinde en az 3 kez). Yalnız NetworkManager satırlarını gönderen tahtalarda görülür.',
            'level' => 'warn',
            'scan' => false,
            'source' => 'Log',
            'source_detail' => 'Tahtanın NetworkManager logları: DHCP hataları (Ankamon bağlanmaz).',
            'every' => '5 dk',
        ],
        'nic_error' => [
            'label' => 'Ağ kartı hatası',
            'description' => 'Ağ kartı sürücüsü takılma/zaman aşımı bildirdi (NETDEV WATCHDOG, tx timeout, Hardware Unit Hang). Kart, kablo ya da sürücü sorunu.',
            'level' => 'bad',
            'scan' => false,
            'source' => 'Log',
            'source_detail' => 'Tahtanın çekirdek logları: ağ kartı hataları (Ankamon bağlanmaz).',
            'every' => '5 dk',
        ],
        'identity_conflict' => [
            'label' => 'Ad / IP çakışması',
            'description' => 'Aynı bilgisayar adı aynı anda birden çok IP\'den log gönderdi (aynı kalıptan kurulmuş tahtalar adı değiştirilmeden) ya da iki tahta kaydı aynı IP\'yi taşıyor. Aynı IP durumu düzelene dek açık kalır.',
            'level' => 'warn',
            'scan' => false,
            'source' => 'Log',
            'source_detail' => 'Loglardaki bilgisayar adı ve gönderen IP (Ankamon bağlanmaz).',
            'every' => '5 dk',
        ],
        'subnet_changed' => [
            'label' => 'Tahta başka ağda',
            'description' => 'Tahtanın logları başka bir IP ağından gelmeye başladı: tahta taşındı, başka VLAN\'a bağlandı ya da Wi-Fi\'ye geçti.',
            'level' => 'warn',
            'scan' => false,
            'source' => 'Log',
            'source_detail' => 'Loglardaki gönderen IP (Ankamon bağlanmaz).',
            'every' => '5 dk',
        ],
        'clock_skew' => [
            'label' => 'Tahta saati yanlış',
            'description' => 'Tahtanın saati sunucununkinden en az 10 dakika sapıyor (logların tahta zamanına göre). NTP eşitlenmemiş kuralı sensör verisi olan tahtaları görür, bu kural log gönderen her tahtayı.',
            'level' => 'warn',
            'scan' => false,
            'source' => 'Log',
            'source_detail' => 'Log satırının tahtadaki zamanı ile Ankamon\'a varış zamanı farkı (Ankamon bağlanmaz).',
            'every' => '5 dk',
        ],
        'cmos_battery_low' => [
            'label' => 'BIOS pili zayıf',
            'description' => 'BIOS (CMOS) pilinin gerilimi 2,4 V\'un altında. Sağlam bir okuma gelene (pil değişene) dek sürer. Yalnız pil sensörü etkinleştirilmiş tahtalarda ölçülür.',
            'level' => 'warn',
            'scan' => true,
            'source' => 'Ölçüm',
            'source_detail' => 'Ankamon\'un tahtanın 9100 portundan 60 sn\'de bir okuduğu pil gerilimi ölçümü (komut çalışmaz).',
            'every' => '60 sn',
        ],
        'uefi_nvram_high' => [
            'label' => 'UEFI NVRAM dolu',
            'description' => 'UEFI değişken deposunun (NVRAM) doluluk oranı filodaki tahtaların ortalamasından en az 10 puan yüksek ya da boş alanı %10\'un altında. Depo dolarsa firmware yeni açılış girdisi/değişken yazamaz: güncellemede önyükleyici kaydı başarısız olabilir, tahta açılmayabilir. Değer Bilgi kartı, ilk tanıma ve haftalık otomatik sorun taramasında toplanır; ortalama için en az 3 tahtanın verisi gerekir.',
            'level' => 'warn',
            'scan' => true,
            'source' => 'SSH verisi',
            'source_detail' => 'Daha önce SSH ile toplanan donanım bilgisi: tahta ilk tanındığında ve Bilgi kartı açıldığında (1 sa önbellek) tazelenir. Kural 60 sn\'de bir bakar ama veri bu kadar güncel değildir.',
            'every' => '60 sn',
        ],
    ];

    /**
     * Bütün türler: çekirdeğinkiler + eklentilerin (ext/<ad>/anomaly_kinds.json — {tür: {label, description,
     * scan?}}; kuralları worker'da ext/<ad>/worker/anomaly_rules.py). Çekirdek eklentiyi adıyla bilmez.
     */
    public static function kinds(): array
    {
        static $kinds = null;
        if ($kinds === null) {
            $kinds = self::KINDS;
            $dir = defined('EXT_DIR') ? EXT_DIR : '/opt/ankamon/ext';
            foreach (glob($dir . '/*/anomaly_kinds.json') ?: [] as $file) {
                $extra = json_decode((string) file_get_contents($file), true);
                // origin: kaydı üreten eklenti (Tahta sağlığı ▸ Denetimler, Durum) — extension.json başlığı, yoksa dizin adı.
                $meta = json_decode((string) @file_get_contents(dirname($file) . '/extension.json'), true);
                $origin = is_array($meta) && !empty($meta['title']) ? (string) $meta['title'] : basename(dirname($file));
                foreach (is_array($extra) ? $extra : [] as $kind => $def) {
                    if (is_string($kind) && is_array($def) && !isset($kinds[$kind])) {
                        $kinds[$kind] = $def + ['origin' => $origin];
                    }
                }
            }
        }
        return $kinds;
    }

    /** Anlık taranabilen türler (JobsApi "anomaly_scan" doğrulaması). */
    public static function scannable(): array
    {
        return array_filter(self::kinds(), static fn(array $k) => !empty($k['scan']));
    }

    public function index(Request $request, array $user): array
    {
        $now = time();
        $to = $request->queryInt('to', $now, 0, $now + 86400);
        $from = $request->queryInt('from', $to - 30 * 86400, 0, $to);
        $limit = $request->queryInt('limit', 20000, 1, 100000);

        $rows = Db::all(
            "SELECT a.id, a.kind, a.board_id, COALESCE(NULLIF(b.label, ''), NULLIF(a.board_name, ''), a.host) AS board, a.host,
                    extract(epoch FROM a.started_at)::bigint AS started_at,
                    extract(epoch FROM a.ended_at)::bigint AS ended_at,
                    a.detail
             FROM anomalies a LEFT JOIN boards b ON b.id = a.board_id
             WHERE a.ended_at IS NULL OR (a.ended_at >= to_timestamp(?) AND a.started_at <= to_timestamp(?))
             ORDER BY a.started_at DESC LIMIT ?",
            [$from, $to, $limit]
        );
        foreach ($rows as &$row) {
            $row['detail'] = json_decode((string) $row['detail'], true) ?: [];
        }
        unset($row);
        $computed = Db::value(
            "SELECT extract(epoch FROM max(value))::bigint FROM task_cursors WHERE name LIKE 'anomaly.%'"
        );
        // Tarama sekmesi açılınca son taramanın sonuçlarını gösterir: kullanıcının kendi son taraması (görev
        // ayrıntısını JobsApi::show yalnız başlatana ve yöneticiye verir); yöneticide herkesinki.
        $lastScan = Db::value(
            "SELECT max(id) FROM jobs WHERE type = 'anomaly_scan' AND (created_by = ? OR ?::boolean)",
            [$user['id'], $user['is_admin'] ? 'true' : 'false']
        );
        return [
            'kinds' => self::kinds(),
            'anomalies' => $rows,
            'computed_at' => $computed === null ? null : (int) $computed,
            'last_scan_job' => $lastScan === null ? null : (int) $lastScan,
        ];
    }
}
