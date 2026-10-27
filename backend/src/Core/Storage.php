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
 * Disk kullanımı penceresinin (log / sensör / görev sekmeleri) ortak yardımcıları.
 *
 * logs ve metrics TimescaleDB hypertable'ıdır: asıl veri chunk tablolarında durur, bu yüzden
 * pg_total_relation_size('<hypertable>') yalnız boş üst tabloyu (birkaç KB) ölçer — gerçek boyut
 * hypertable_size() ile alınır. Sıkıştırılmış chunk'larda DELETE satırları önce açar ve TimescaleDB
 * varsayılan olarak tek transaction'da 100 000 satırdan fazlasını açmayı reddeder
 * ("tuple decompression limit exceeded") — kalıcı silme bu sınırı yalnız o transaction için kaldırır.
 */
final class Storage
{
    /** Hypertable ise hypertable_size(), değilse pg_total_relation_size() (bayt). */
    public static function relationBytes(string $table): int
    {
        $isHyper = Db::value(
            "SELECT 1 FROM timescaledb_information.hypertables
             WHERE format('%I.%I', hypertable_schema, hypertable_name)::regclass = ?::regclass",
            [$table]
        );
        $sql = $isHyper ? 'SELECT hypertable_size(?::regclass)' : 'SELECT pg_total_relation_size(?::regclass)';
        return (int) (Db::value($sql, [$table]) ?? 0);
    }

    /**
     * Verilen DELETE ifadelerini tek transaction'da, sıkıştırma açma sınırı kaldırılmış olarak
     * çalıştırır. @param list<array{0:string,1:array}> $statements [sql, params] çiftleri
     * @return list<int> her ifadenin sildiği satır sayısı
     */
    public static function delete(array $statements): array
    {
        return Db::transaction(function () use ($statements) {
            Db::exec('SET LOCAL timescaledb.max_tuples_decompressed_per_dml_transaction = 0');
            return array_map(fn(array $s) => Db::exec($s[0], $s[1]), $statements);
        });
    }

    /**
     * Kalıcı veri bağlama noktasının (bkz. docker-compose.yml `${DATA_DIR}:/data`) gerçek disk
     * toplam/boş alanı — tahmini boyutların aksine burası yaklaşık değil, host dosya sistemine ait.
     */
    public static function diskSpace(): array
    {
        $total = @disk_total_space('/data');
        $free = @disk_free_space('/data');
        return [
            'total' => $total !== false ? (int) $total : null,
            'free' => $free !== false ? (int) $free : null,
        ];
    }

    private const ROOT_REQUESTS = '/run/ankamon/storage-ops';
    private const ROOT_WAIT_SECONDS = 20;

    /**
     * Root gerektiren bir silmeyi storage-ops servisine yaptırır ve sonucunu bekler (bkz.
     * docker/rootfs/services/storage-ops.sh — hedefler, satır biçimi ve ad doğrulaması orada).
     * Adlar çağıranda da doğrulanmış olmalı; servis ayrıca kendi desenleriyle yeniden doğrular.
     * @param list<string> $lines @return int silinen adet
     */
    public static function rootRequest(string $target, array $lines): int
    {
        if (!is_dir(self::ROOT_REQUESTS) || !is_writable(self::ROOT_REQUESTS)) {
            throw new ApiError(503, 'Silme servisi (storage-ops) istek kabul etmiyor — servis çalışmıyor olabilir.');
        }
        $id = self::ROOT_REQUESTS . '/' . bin2hex(random_bytes(8));
        // Önce .tmp, sonra yeniden adlandırma: servis yarım yazılmış isteği okumasın.
        file_put_contents("$id.tmp", $target . "\n" . implode("\n", $lines) . "\n");
        rename("$id.tmp", "$id.req");

        $deadline = microtime(true) + self::ROOT_WAIT_SECONDS;
        while (!is_file("$id.done")) {
            if (microtime(true) > $deadline) {
                @unlink("$id.req");
                throw new ApiError(504, 'Silme servisi zamanında yanıt vermedi; silme yapılmamış ya da yarım kalmış olabilir.');
            }
            usleep(250_000);
        }
        $done = (int) trim((string) file_get_contents("$id.done"));
        @unlink("$id.done");
        return $done;
    }

    /** Toplam baytı satır sayılarına orantılı paylaştırır (arayüzde "~" ile gösterilir). */
    public static function share(int $bytes, int $n, int $total): int
    {
        return $total > 0 ? (int) round($bytes * $n / $total) : 0;
    }
}
