<?php
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
