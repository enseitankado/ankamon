<?php
/*
 * SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

declare(strict_types=1);

// Özellikler arası bağımlılık (alt özellik => üst özellik): alt özellik yalnız üstüyle birlikte
// kullanılabilir — ör. "shell" Cihazlar sayfasının sağ menüsünden açılır, sayfa ise "devices" ister.
// UsersApi kaydederken üst özelliği kendiliğinden ekler; Kullanıcılar penceresi alt özellikleri
// üstünün altında girintili gösterir ve üstü kapalıyken devre dışı bırakır.
$ozellikBagimliliklari = [
    'devices.manage' => 'devices',
    'actions' => 'devices',
    'power' => 'devices',
    'shell' => 'devices',
    'screen' => 'devices',
    'screen.control' => 'screen',
    'screen.lock' => 'screen',
    'screen.screenshot' => 'screen',
    'screen.input' => 'screen',
    'screen.relay' => 'screen',
    'devices.chat' => 'devices',
    'cast' => 'devices',
    'filemanager' => 'devices',
    'taskmgr' => 'devices',
    'devices.backup' => 'devices',
    'devices.restore' => 'devices',
    'devices.login' => 'devices',
    'devices.users' => 'devices',
    'anomalies' => 'devices',
    'anomalies.notify' => 'anomalies',
    'screen.web' => 'screen',
    'devices.webfilter' => 'devices',
    'devices.sound' => 'devices',
    'devices.passwords' => 'devices',
    'devices.passwords.etapadmin' => 'devices.passwords',
    'devices.passwords.root' => 'devices.passwords',
    'logs.manage' => 'logs',
    'logs.exclude' => 'logs',
    'sessions.manage' => 'logs',
    'sessions.hosts' => 'logs',
    'leagues.exclude' => 'logs',
    'network.manage' => 'network',
];

// Eklentilerin kendi yetkileri: ext/<ad>/feature_deps.php aynı biçimde dizi döndürür (çekirdek hiçbir eklentiyi adıyla
// bilmez). Çekirdek anahtarı ezilemez; etkin olmayan eklentinin yetkisi de listelenir (yönetici önceden verebilsin).
foreach (glob(\Ankamon\Core\Extensions::dir() . '/*/feature_deps.php') ?: [] as $eklentiDosyasi) {
    // Eski yetki adları (boards… → devices…, bkz. Auth::feature) yeni adla eşlenir.
    foreach ((array) require $eklentiDosyasi as $alt => $ust) {
        $ozellikBagimliliklari += [\Ankamon\Core\Auth::feature((string) $alt) => \Ankamon\Core\Auth::feature((string) $ust)];
    }
}
return $ozellikBagimliliklari;
