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
 * Sunucunun ağ kartını etkin/pasif yapma isteği (Ayarlar ▸ Ağ arabirimleri; kullanıcı isteği 2026-11-10). PHP (nobody)
 * `ip link` çalıştıramaz: istek root çalışan netif-ops servisine dosyayla iletilir ve sonucu beklenir (bkz.
 * docker/rootfs/services/netif-ops.sh — adı orada da katı doğrulanır; pasif kartlar /data/netif/disabled'da saklanır).
 */
final class NetifControl
{
    private const REQUESTS = '/run/ankamon/netif-ops';
    private const WAIT_SECONDS = 15;
    public const STATE_FILE = '/data/netif/disabled';

    /** @throws ApiError servis yoksa, zaman aşımında ya da `ip link` hata verirse */
    public static function setEnabled(string $name, bool $enabled): void
    {
        if (!preg_match('/^[A-Za-z0-9_.:@-]{1,15}$/', $name) || preg_match('/^(lo|docker|br-|veth)/', $name)) {
            throw ApiError::badRequest('Geçersiz arabirim adı.');
        }
        if (!is_dir(self::REQUESTS) || !is_writable(self::REQUESTS)) {
            throw new ApiError(503, 'Arabirim servisi (netif-ops) istek kabul etmiyor — servis çalışmıyor olabilir.');
        }
        $id = self::REQUESTS . '/' . bin2hex(random_bytes(8));
        file_put_contents("$id.tmp", ($enabled ? 'up' : 'down') . "\n$name\n");
        rename("$id.tmp", "$id.req");
        $deadline = microtime(true) + self::WAIT_SECONDS;
        while (!is_file("$id.done")) {
            if (microtime(true) > $deadline) {
                @unlink("$id.req");
                throw new ApiError(504, 'Arabirim servisi zamanında yanıt vermedi.');
            }
            usleep(200_000);
        }
        $result = trim((string) file_get_contents("$id.done"));
        @unlink("$id.done");
        if ($result !== 'ok') {
            throw new ApiError(500, "Arabirim değiştirilemedi ($name): " . preg_replace('/^hata:\s*/u', '', $result));
        }
    }

    /** Ankamon ayarıyla pasif yapılmış kartlar (servisin durum dosyası). @return list<string> */
    public static function disabled(): array
    {
        $lines = is_readable(self::STATE_FILE) ? (file(self::STATE_FILE, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: []) : [];
        return array_values(array_unique(array_map('trim', $lines)));
    }
}
