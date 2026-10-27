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

/** settings tablosu: anahtar → JSON değer. Worker da aynı tabloyu okur. */
final class Settings
{
    /** Varsayılanlar; tabloda olmayan anahtarlar için kullanılır. */
    public const DEFAULTS = [
        // SSH: Ansible (uzaktan işlemler, toplu komut) ve web terminal bu hesabı kullanır.
        'ssh_access' => ['user' => 'root', 'password' => ''],
        // Samba: şu an yalnız saklanır; TiHA'nın "Dosya sunucusu" adımıyla aynı hesabı tutmak içindir.
        'samba_access' => ['user' => 'root', 'password' => ''],
        // Okulun ders saatleri (bkz. Api\LessonTimesApi): hangi günler ders var (1=Pzt … 7=Paz) ve
        // [{name, start: "HH:MM", end: "HH:MM"}] — Oturumlar çizelgesi oturumu derslere eşler.
        'lesson_times' => ['days' => [1, 2, 3, 4, 5], 'lessons' => []],
        // Ekranlar: tahtada x11vnc yoksa "Ekran istemcisini kur" (actions/vnc-install) arka planda
        // kendiliğinden çalıştırılsın mı (bkz. worker/ankamon/screen/__main__.py). Varsayılan: evet.
        'screen_vnc_autoinstall' => true,
        // Ağ rolleri (Ayarlar ▸ Ağ arabirimleri; bkz. worker/ankamon/netroles.py): tahta ağı ve idari ağın
        // arabirim adları. Boş = otomatik (bağlı her ağ tahta ağı sayılır). Tahta işleri (ağ taraması,
        // syslog'dan tahta kaydı, Samba paylaşım taraması) yalnız tahta ağında yapılır.
        'network_roles' => ['board_iface' => '', 'admin_iface' => ''],
    ];

    public static function get(string $key): mixed
    {
        $raw = Db::value('SELECT value FROM settings WHERE key = ?', [$key]);
        $value = $raw === null ? null : json_decode((string) $raw, true);
        $default = self::DEFAULTS[$key] ?? null;
        return is_array($default) && is_array($value) ? array_merge($default, $value) : ($value ?? $default);
    }

    public static function set(string $key, mixed $value): void
    {
        Db::exec(
            'INSERT INTO settings (key, value) VALUES (?, ?::jsonb)
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()',
            [$key, json_encode($value, JSON_UNESCAPED_UNICODE)]
        );
    }
}
