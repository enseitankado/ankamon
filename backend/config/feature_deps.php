<?php
/*
 * SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

declare(strict_types=1);

// Özellikler arası bağımlılık (alt özellik => üst özellik): alt özellik yalnız üstüyle birlikte
// kullanılabilir — ör. "shell" Tahtalar sayfasının sağ menüsünden açılır, sayfa ise "boards" ister.
// UsersApi kaydederken üst özelliği kendiliğinden ekler; Kullanıcılar penceresi alt özellikleri
// üstünün altında girintili gösterir ve üstü kapalıyken devre dışı bırakır.
return [
    'boards.manage' => 'boards',
    'actions' => 'boards',
    'power' => 'boards',
    'shell' => 'boards',
    'screen' => 'boards',
    'screen.control' => 'screen',
    'cast' => 'boards',
    'filemanager' => 'boards',
    'taskmgr' => 'boards',
    'boards.backup' => 'boards',
    'boards.login' => 'boards',
    'boards.users' => 'boards',
    'anomalies' => 'boards',
    'boards.passwords' => 'boards',
    'boards.passwords.etapadmin' => 'boards.passwords',
    'boards.passwords.root' => 'boards.passwords',
    'logs.manage' => 'logs',
    'logs.exclude' => 'logs',
    'sessions.manage' => 'logs',
    'sessions.hosts' => 'logs',
    'network.manage' => 'network',
];
