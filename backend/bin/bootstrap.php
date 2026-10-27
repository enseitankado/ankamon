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

// Konteyner her başladığında çalışır: etapadmin hesabını ve tahta erişim ayarını (yalnız yoksa) oluşturur.

use Ankamon\Core\Auth;
use Ankamon\Core\Db;
use Ankamon\Core\Settings;

spl_autoload_register(static function (string $class): void {
    if (str_starts_with($class, 'Ankamon\\')) {
        require dirname(__DIR__) . '/src/' . str_replace('\\', '/', substr($class, 8)) . '.php';
    }
});

if (!Db::value('SELECT 1 FROM users WHERE username = ?', [Auth::ADMIN_USERNAME])) {
    $password = getenv('ETAPADMIN_PASSWORD') ?: '';
    if (strlen($password) < 8) {
        fwrite(STDERR, "ETAPADMIN_PASSWORD .env içinde en az 8 karakter olmalı; etapadmin oluşturulamadı.\n");
        exit(1);
    }
    Db::exec(
        'INSERT INTO users (username, full_name, password_hash, is_admin) VALUES (?, ?, ?, true)',
        [Auth::ADMIN_USERNAME, 'Etap Yönetici', password_hash($password, PASSWORD_DEFAULT)]
    );
    echo "etapadmin hesabı oluşturuldu.\n";
}

// Eski tek-anahtarlı kurulumlardan geçiş: 'board_access' varsa ve 'ssh_access' yoksa taşı.
$legacy = Db::value("SELECT value FROM settings WHERE key = 'board_access'");
if ($legacy !== null && Db::value("SELECT 1 FROM settings WHERE key = 'ssh_access'") === null) {
    Settings::set('ssh_access', json_decode((string) $legacy, true));
    echo "Eski 'board_access' ayarı 'ssh_access' olarak taşındı.\n";
}

if (Db::value("SELECT 1 FROM settings WHERE key = 'ssh_access'") === null) {
    Settings::set('ssh_access', [
        'user' => getenv('BOARD_SSH_USER') ?: 'root',
        'password' => getenv('BOARD_SSH_PASSWORD') ?: '',
    ]);
    echo "SSH erişim bilgileri ayarlara yazıldı.\n";
}
if (Db::value("SELECT 1 FROM settings WHERE key = 'samba_access'") === null) {
    Settings::set('samba_access', [
        'user' => getenv('BOARD_SMB_USER') ?: 'root',
        'password' => getenv('BOARD_SMB_PASSWORD') ?: '',
    ]);
    echo "Samba erişim bilgileri ayarlara yazıldı.\n";
}
