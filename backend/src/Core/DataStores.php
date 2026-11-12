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
 * Ankamon'un veri depoları ve her birinin hangi yedeğe girdiği — Sistem ▸ Yedekler'in "Veri depoları" tablosu.
 *
 * Kendiliğinden kapsanır (yeni depo eklenince bir şey yapmak gerekmez):
 *  - veritabanındaki her yeni tablo yapılandırma + tam yedeğe, her yeni zaman serisi tablosu (hypertable) tam yedeğe
 *    girer (pg_dump bütün veritabanını alır — bkz. docker/backup/backup.sh);
 *  - /data altında açılan her yeni dizin dosya yedeğine girer (docker/backup/files-exclude.conf'ta yoksa).
 * Yeni bir /data dizini ya da veritabanı açılırsa KNOWN_DIRS'e açıklaması yazılır (yoksa tabloda "tanımsız" görünür);
 * yedek dışı kalması gerekiyorsa nedeniyle files-exclude.conf'a eklenir. Ayrı bir veritabanı (grafana gibi) eklenirse
 * backup.sh'a dökümü ve buraya satırı eklenir.
 */
final class DataStores
{
    private const DATA = '/data';
    private const EXCLUDE = '/opt/ankamon/backup/files-exclude.conf';

    /** /data alt dizinleri: ad → [kısa ad, açıklama]. */
    private const KNOWN_DIRS = [
        'tls' => ['TLS sertifikaları', 'Sertifikalar ve yerel sertifika yetkilisinin (CA) anahtarı — kaybolursa cihazlardaki güven bozulur'],
        'filemanager' => ['Dosya yöneticisi', 'FileBrowser kullanıcı ve ayar veritabanı'],
        'files' => ['Toplu dosya alanı', 'Toplu dosya dağıtma/toplama çalışma alanı'],
        'tools' => ['Dış araçlar', 'Cihazlara kurulan dış araçlar (TiHA, eta-112 vb.) ve sürüm bilgisi'],
        'screenshots' => ['Ekran görüntüleri', 'Cihazlardan alınan ekran görüntüleri'],
        'telegraf' => ['Sensör toplayıcı ayarı', 'Telegraf hedef listesi'],
        'netif' => ['Ağ arabirimleri', 'Ağ arabirimi ayarları'],
        'grafana' => ['Grafana dosyaları', 'Grafana eklenti/oturum dosyaları (panolar grafana veritabanında)'],
        'postgres' => ['Veritabanı dosyaları', 'PostgreSQL veri dizini'],
        'backups' => ['Yedekler', 'Yedek dosyaları'],
        'home-backups' => ['Ev dizini yedekleri', 'Cihaz ev dizini yedekleri (Yedekle/Geri al)'],
        'rsyslog' => ['Log kuyruğu', 'Veritabanına yazılmayı bekleyen loglar'],
        '.exports' => ['Geçici indirmeler', 'Disk kullanımı ▸ İndir dosyaları'],
        'ext' => ['Eklenti verileri', 'Eklentilerin kendi dosyaları (/data/ext/<eklenti>)'],
    ];

    /** @return list<array{store:string, location:string, kind:string, backups:list<string>, note:string}> */
    public static function all(): array
    {
        $hyper = array_column(Db::all(
            "SELECT hypertable_name FROM timescaledb_information.hypertables WHERE hypertable_schema = 'public' ORDER BY 1"), 'hypertable_name');
        $tables = (int) Db::value("SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'");
        $rows = [
            ['store' => 'Ayarlar ve kayıtlar', 'location' => 'veritabanı: ankamon', 'kind' => 'db',
             'backups' => ['config', 'full'],
             'note' => sprintf('%d tablo — kullanıcılar, cihazlar, ayarlar, görevler, raporlar… (yeni tablolar kendiliğinden girer)', max(0, $tables - count($hyper)))],
            ['store' => 'Loglar ve sensör verisi', 'location' => 'veritabanı: ankamon (zaman serisi)', 'kind' => 'db',
             'backups' => ['full'],
             'note' => 'Zaman serisi tabloları: ' . ($hyper ? implode(', ', $hyper) : '—') . ' — büyük olduğundan yalnız tam yedekte'],
            ['store' => 'Grafana', 'location' => 'veritabanı: grafana', 'kind' => 'db', 'backups' => ['config'],
             'note' => 'Sensör panoları ve Grafana ayarları'],
        ];
        $excluded = self::excluded();
        $dirs = array_filter(@scandir(self::DATA) ?: [], static fn($n) => $n !== '.' && $n !== '..' && is_dir(self::DATA . "/$n"));
        sort($dirs);
        foreach ($dirs as $name) {
            [$label, $known] = self::KNOWN_DIRS[$name] ?? [$name, null];
            $rows[] = [
                'store' => $label,
                'location' => self::DATA . "/$name",
                'kind' => 'dir',
                'backups' => isset($excluded[$name]) ? [] : ['files'],
                'note' => isset($excluded[$name])
                    ? 'Yedek dışı: ' . $excluded[$name]
                    : ($known ?? 'Tanımsız dizin — dosya yedeğine kendiliğinden giriyor (açıklaması Core\\DataStores::KNOWN_DIRS\'e yazılmalı)'),
                'unknown' => $known === null,
            ];
        }
        return $rows;
    }

    /** files-exclude.conf: dizin adı → neden. */
    public static function excluded(): array
    {
        $out = [];
        foreach (@file(self::EXCLUDE, FILE_IGNORE_NEW_LINES) ?: [] as $line) {
            if ($line === '' || $line[0] === '#' || !str_contains($line, "\t")) {
                continue;
            }
            [$name, $why] = explode("\t", $line, 2);
            $out[$name] = $why;
        }
        return $out;
    }
}
