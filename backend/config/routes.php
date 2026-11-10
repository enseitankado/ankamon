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

use Ankamon\Api;

// [METOD, yol, [sınıf, metot], erişim] — erişim için bkz. Core\Router.
return [
    ['GET',    '/api/health',            [Api\HealthApi::class, 'health'],     'public'],
    ['GET',    '/api/surum-damgasi',     [Api\HealthApi::class, 'surumDamgasi'], 'user'],
    // Ankamon simgesi → geliştiriciye anonim mesaj (ntfy ankamon-iletisim; bkz. DeveloperContactApi).
    ['POST',   '/api/developer-contact', [Api\DeveloperContactApi::class, 'send'], 'user'],
    // Giriş ekranı durum satırı: yalnız sayılar (bkz. LoginStatusApi).
    ['GET',    '/api/login-status',      [Api\LoginStatusApi::class, 'status'], 'public'],

    ['POST',   '/api/auth/login',        [Api\AuthApi::class, 'login'],        'public'],
    ['POST',   '/api/auth/logout',       [Api\AuthApi::class, 'logout'],       'public'],
    ['GET',    '/api/auth/me',           [Api\AuthApi::class, 'me'],           'user'],
    ['POST',   '/api/auth/password',     [Api\AuthApi::class, 'password'],     'user'],
    ['PUT',    '/api/auth/theme',        [Api\AuthApi::class, 'theme'],        'user'],
    ['PUT',    '/api/auth/nav-order',    [Api\AuthApi::class, 'navOrder'],     'user'],
    ['PUT',    '/api/auth/screen-order', [Api\AuthApi::class, 'screenOrder'],  'user'],
    ['PUT',    '/api/auth/prefs',        [Api\AuthApi::class, 'prefs'],        'user'],
    ['GET',    '/api/auth/grafana',      [Api\AuthApi::class, 'grafana'],      'public'],
    ['GET',    '/api/auth/shell',        [Api\AuthApi::class, 'shell'],        'public'],
    ['GET',    '/api/auth/devproxy',     [Api\DeviceWebProxyApi::class, 'proxyAuth'], 'public'],
    ['GET',    '/api/auth/screen',       [Api\AuthApi::class, 'screen'],       'public'],
    ['GET',    '/api/auth/cast',         [Api\AuthApi::class, 'cast'],         'public'],
    ['GET',    '/api/auth/taskmgr',      [Api\AuthApi::class, 'taskmgr'],      'public'],
    ['GET',    '/api/auth/chat',         [Api\AuthApi::class, 'chat'],         'public'],
    // Yansıtma penceresinin tüketim tablosu: yayını okuyan tahtaların aldığı veri (MediaMTX API'si).
    ['GET',    '/api/cast/stats',        [Api\CastApi::class, 'stats'],        'cast'],
    ['GET',    '/api/auth/filemanager',  [Api\AuthApi::class, 'filemanager'],  'public'],
    ['GET',    '/api/auth/home-restore', [Api\AuthApi::class, 'homeRestore'],  'public'],

    ['GET',    '/api/dashboard',         [Api\DashboardApi::class, 'summary'], 'dashboard'],

    ['GET',    '/api/boards',            [Api\BoardsApi::class, 'index'],      'boards'],
    ['POST',   '/api/boards',            [Api\BoardsApi::class, 'create'],     'boards.manage'],
    ['GET',    '/api/boards/{id}',       [Api\BoardsApi::class, 'show'],       'boards'],
    ['PATCH',  '/api/boards/{id}',       [Api\BoardsApi::class, 'update'],     'boards.manage'],
    ['DELETE', '/api/boards/{id}',       [Api\BoardsApi::class, 'delete'],     'boards.manage'],
    ['GET',    '/api/boards/{id}/shell', [Api\BoardsApi::class, 'shell'],      'shell'],
    ['GET',    '/api/boards/{id}/filemanager', [Api\BoardsApi::class, 'filemanager'], 'filemanager'],

    // Ağ envanteri (sol menü "Ağ") — bkz. NetworkApi, worker/ankamon/netscan.
    ['GET',    '/api/network',               [Api\NetworkApi::class, 'index'],          'network'],
    ['GET',    '/api/network/state',         [Api\NetworkApi::class, 'state'],          'network'],
    ['GET',    '/api/network/devices',       [Api\NetworkApi::class, 'devices'],        'network'],
    ['POST',   '/api/network/devices',       [Api\NetworkApi::class, 'createDevice'],   'network.manage'],
    ['DELETE', '/api/network/devices',       [Api\NetworkApi::class, 'deleteDevices'],  'network.manage'],
    ['PATCH',  '/api/network/devices/{id}',  [Api\NetworkApi::class, 'updateDevice'],   'network.manage'],
    // Varlıklar ▸ Web arayüzünü aç: aynı ağ → doğrudan adres, değilse konteyner vekili (bkz. Api\DeviceWebProxyApi).
    ['POST',   '/api/network/devices/{id}/web', [Api\DeviceWebProxyApi::class, 'open'], 'network'],
    ['PATCH',  '/api/network/networks/{id}', [Api\NetworkApi::class, 'updateNetwork'],  'network.manage'],
    ['DELETE', '/api/network/networks/{id}', [Api\NetworkApi::class, 'deleteNetwork'],  'network.manage'],
    // Varlık grupları (Ağ ▸ Varlıklar ▸ <grup>) — bkz. Api\NetDeviceGroupsApi.
    ['GET',    '/api/network/groups',        [Api\NetDeviceGroupsApi::class, 'deviceGroups'],      'network'],
    ['POST',   '/api/network/groups',        [Api\NetDeviceGroupsApi::class, 'createDeviceGroup'], 'network.manage'],
    ['PATCH',  '/api/network/groups/{id}',   [Api\NetDeviceGroupsApi::class, 'updateDeviceGroup'], 'network.manage'],
    ['DELETE', '/api/network/groups/{id}',   [Api\NetDeviceGroupsApi::class, 'deleteDeviceGroup'], 'network.manage'],
    ['POST',   '/api/network/scan',         [Api\NetworkApi::class, 'scan'],           'network.manage'],
    ['POST',   '/api/network/ping',          [Api\NetworkApi::class, 'ping'],           'network.manage'],

    ['GET',    '/api/logs',              [Api\LogsApi::class, 'index'],        'logs'],
    ['GET',    '/api/command-logs',      [Api\CommandLogApi::class, 'index'],  'logs'],
    ['GET',    '/api/board-sessions',    [Api\SessionsApi::class, 'index'],    'logs'],
    ['GET',    '/api/board-uptime',      [Api\UptimeApi::class, 'index'],      'logs'],
    // Oturumlar ▸ Şampiyonlar Ligi: en uzun oturum süresi sıralamaları (bkz. SessionLeagueApi).
    ['GET',    '/api/session-league',    [Api\SessionLeagueApi::class, 'index'], 'logs'],
    // Oturumlar ▸ Teneffüs Ligi: ders aralarında açık kalan tahtalar (bkz. BreakLeagueApi).
    ['GET',    '/api/break-league',      [Api\BreakLeagueApi::class, 'index'], 'logs'],
    // Liglerin dışında bırakılan kullanıcı/tahtalar (bkz. LeagueExclusionsApi).
    ['GET',    '/api/league-exclusions', [Api\LeagueExclusionsApi::class, 'index'], 'logs'],
    ['PUT',    '/api/league-exclusions', [Api\LeagueExclusionsApi::class, 'update'], 'leagues.exclude'],
    // Tahtalar ▸ Anomaliler (bkz. AnomaliesApi, worker/ankamon/anomaly).
    ['GET',    '/api/anomalies',         [Api\AnomaliesApi::class, 'index'],   'anomalies'],
    // Tahta sağlığı ▸ Yardım ▸ Denetim türleri: tür ayarları (sıklık, düzey, anlık taranır) ve SSH denetimi aralığı.
    ['PUT',    '/api/anomaly-kinds',     [Api\AnomaliesApi::class, 'updateKind'], 'admin'],
    ['PUT',    '/api/diagnose/interval', [Api\DiagnoseApi::class, 'setInterval'], 'admin'],
    // Tahta sağlığı ▸ Durum: sürekli izleme + SSH denetimi bulguları tek biçimde (yetki içeride: anomalies / diagnose).
    ['GET',    '/api/board-health',      [Api\BoardHealthApi::class, 'index'], 'user'],
    ['DELETE', '/api/board-sessions',    [Api\SessionsApi::class, 'delete'],   'sessions.manage'],
    ['DELETE', '/api/board-hosts',       [Api\SessionsApi::class, 'deleteHost'], 'sessions.hosts'],
    ['GET',    '/api/logs/stats',        [Api\LogStatsApi::class, 'stats'],    'logs'],
    ['DELETE', '/api/logs',              [Api\LogStatsApi::class, 'delete'],   'logs.manage'],
    // Loglar grid'inden dışlanan (önemsiz) mesajlar — kayıt silinmez, grid'de herkes için gizlenir.
    ['GET',    '/api/log-exclusions',    [Api\LogExclusionsApi::class, 'index'],  'logs'],
    ['GET',    '/api/log-exclusions/preview', [Api\LogExclusionsApi::class, 'preview'], 'logs.exclude'],
    ['POST',   '/api/log-exclusions',    [Api\LogExclusionsApi::class, 'create'], 'logs.exclude'],
    ['DELETE', '/api/log-exclusions',    [Api\LogExclusionsApi::class, 'delete'], 'logs.exclude'],
    // Disk kullanımı penceresinin sensör / görev kuyruğu / yedek / log kuyruğu sekmeleri (log sekmeleri yukarıdaki iki rota).
    ['GET',    '/api/storage/metrics',   [Api\MetricStatsApi::class, 'stats'], 'logs.manage'],
    ['DELETE', '/api/storage/metrics',   [Api\MetricStatsApi::class, 'delete'], 'logs.manage'],
    ['GET',    '/api/storage/jobs',      [Api\JobStatsApi::class, 'stats'],    'logs.manage'],
    ['DELETE', '/api/storage/jobs',      [Api\JobStatsApi::class, 'delete'],   'logs.manage'],
    ['GET',    '/api/storage/diagnose',  [Api\JobStatsApi::class, 'diagnoseStats'], 'logs.manage'],
    ['DELETE', '/api/storage/diagnose',  [Api\JobStatsApi::class, 'diagnoseDelete'], 'logs.manage'],
    ['GET',    '/api/screenshots',       [Api\ScreenshotsApi::class, 'index'], 'logs'],
    ['GET',    '/api/screenshots/{id}/image', [Api\ScreenshotsApi::class, 'image'], 'logs'],
    ['DELETE', '/api/screenshots/{id}',  [Api\ScreenshotsApi::class, 'deleteOne'], 'logs.manage'],
    ['GET',    '/api/storage/screenshots', [Api\ScreenshotsApi::class, 'stats'], 'logs.manage'],
    ['DELETE', '/api/storage/screenshots', [Api\ScreenshotsApi::class, 'delete'], 'logs.manage'],
    ['GET',    '/api/chat/messages',     [Api\ChatApi::class, 'messages'],     'logs'],
    ['GET',    '/api/storage/chat',      [Api\ChatApi::class, 'stats'],        'logs.manage'],
    ['DELETE', '/api/storage/chat',      [Api\ChatApi::class, 'delete'],       'logs.manage'],
    ['GET',    '/api/session-activity',  [Api\SessionActivityApi::class, 'index'], 'logs'],
    ['GET',    '/api/storage/session-activity', [Api\SessionActivityApi::class, 'stats'], 'logs.manage'],
    ['DELETE', '/api/storage/session-activity', [Api\SessionActivityApi::class, 'delete'], 'logs.manage'],
    ['GET',    '/api/ntfy',              [Api\NtfyApi::class, 'index'],        'anomalies'],
    ['PUT',    '/api/ntfy/config',       [Api\NtfyApi::class, 'saveConfig'],   'anomalies.notify'],
    ['POST',   '/api/ntfy/rules',        [Api\NtfyApi::class, 'createRule'],   'anomalies.notify'],
    ['PUT',    '/api/ntfy/rules/{id}',   [Api\NtfyApi::class, 'updateRule'],   'anomalies.notify'],
    ['DELETE', '/api/ntfy/rules/{id}',   [Api\NtfyApi::class, 'deleteRule'],   'anomalies.notify'],
    ['DELETE', '/api/ntfy/messages',     [Api\NtfyApi::class, 'deleteMessages'], 'anomalies.notify'],
    ['GET',    '/api/storage/ntfy',      [Api\NtfyApi::class, 'stats'],        'logs.manage'],
    ['DELETE', '/api/storage/ntfy',      [Api\NtfyApi::class, 'deleteMessages'], 'logs.manage'],
    ['GET',    '/api/storage/backups',   [Api\BackupStatsApi::class, 'stats'], 'logs.manage'],
    ['DELETE', '/api/storage/backups',   [Api\BackupStatsApi::class, 'delete'], 'logs.manage'],
    ['GET',    '/api/storage/policy',    [Api\StoragePolicyApi::class, 'policy'], 'logs.manage'],
    ['GET',    '/api/storage/logqueue',  [Api\LogQueueStatsApi::class, 'stats'], 'logs.manage'],
    ['DELETE', '/api/storage/logqueue',  [Api\LogQueueStatsApi::class, 'delete'], 'logs.manage'],
    ['GET',    '/api/activity',          [Api\ActivityApi::class, 'index'],    'user'],
    ['GET',    '/api/system/stats',      [Api\SystemApi::class, 'stats'],      'user'],
    // Sistem sayfası (yalnız yönetici): servisler, zamanlanmış işler, veritabanı, yapılandırma.
    ['GET',    '/api/system/overview',   [Api\SystemInfoApi::class, 'overview'], 'admin'],
    ['GET',    '/api/system/services',   [Api\ServicesApi::class, 'index'],     'admin'],
    ['POST',   '/api/system/services',   [Api\ServicesApi::class, 'control'],   'admin'],
    ['GET',    '/api/system/jobs',       [Api\SystemInfoApi::class, 'jobs'],     'admin'],
    ['POST',   '/api/system/jobs/run',   [Api\SystemInfoApi::class, 'runJob'],   'admin'],
    ['GET',    '/api/system/database',   [Api\SystemInfoApi::class, 'database'], 'admin'],
    ['GET',    '/api/system/config',     [Api\SystemInfoApi::class, 'config'],   'admin'],
    ['GET',    '/api/system/software',   [Api\SoftwareApi::class, 'index'],   'admin'],
    ['GET',    '/api/metrics/latest',    [Api\MetricsApi::class, 'latest'],    'boards'],
    ['GET',    '/api/metrics/{id}/sensors', [Api\MetricsApi::class, 'sensors'], 'boards'],
    ['GET',    '/api/metrics/info',      [Api\MetricsInfoApi::class, 'info'],  'metrics'],
    ['GET',    '/api/metrics/coverage',  [Api\MetricsApi::class, 'coverage'], 'metrics'],

    ['GET',    '/api/actions',           [Api\ActionsApi::class, 'index'],     'user'],
    ['GET',    '/api/diagnose',          [Api\DiagnoseApi::class, 'runs'],    'diagnose'],
    ['GET',    '/api/diagnose/latest',   [Api\DiagnoseApi::class, 'latest'],  'diagnose'],
    ['GET',    '/api/diagnose/{id}',     [Api\DiagnoseApi::class, 'show'],    'diagnose'],
    ['GET',    '/api/jobs',              [Api\JobsApi::class, 'index'],        'user'],
    ['POST',   '/api/jobs',              [Api\JobsApi::class, 'create'],       'user'],
    ['GET',    '/api/jobs/{id}',         [Api\JobsApi::class, 'show'],         'user'],
    ['GET',    '/api/home-backups/{id}', [Api\HomeBackupApi::class, 'download'], 'boards.backup'],
    ['GET',    '/api/jobs/{id}/events',  [Api\JobsApi::class, 'events'],       'user'],

    ['GET',    '/api/features',          [Api\UsersApi::class, 'features'],    'admin'],
    ['GET',    '/api/users',             [Api\UsersApi::class, 'index'],       'admin'],
    ['POST',   '/api/users',             [Api\UsersApi::class, 'create'],      'admin'],
    ['PATCH',  '/api/users/{id}',        [Api\UsersApi::class, 'update'],      'admin'],
    ['DELETE', '/api/users/{id}',        [Api\UsersApi::class, 'delete'],      'admin'],

    ['GET',    '/api/settings',          [Api\SettingsApi::class, 'show'],     'admin'],
    ['PUT',    '/api/settings',          [Api\SettingsApi::class, 'update'],   'admin'],
    ['POST',   '/api/settings/interface', [Api\SettingsApi::class, 'setInterface'], 'admin'],
    // Eklentiler (ext/<ad>): çekirdek adlarını bilmez, EXT_DIR taranır (bkz. Core\Extensions). Ad gövdede
    // taşınır; Router'daki {id} yalnız rakam eşlediğinden yola konmaz.
    ['GET',    '/api/extensions',          [Api\ExtensionsApi::class, 'list'],         'admin'],
    ['GET',    '/api/extensions/active',   [Api\ExtensionsApi::class, 'active'],       'user'],
    ['PUT',    '/api/extensions/settings', [Api\ExtensionsApi::class, 'saveSettings'], 'admin'],
    // Wi-Fi Monitör "sabit" vericileri (sınıfın/okulun olağan ağları ve cihazları; bkz. WifimonFixedEmittersApi).
    ['GET',    '/api/wifimon/fixed',     [Api\WifimonFixedEmittersApi::class, 'index'],  'screen'],
    ['POST',   '/api/wifimon/fixed',     [Api\WifimonFixedEmittersApi::class, 'create'], 'screen'],
    ['DELETE', '/api/wifimon/fixed',     [Api\WifimonFixedEmittersApi::class, 'delete'], 'screen'],
    ['GET',    '/api/lesson-times',      [Api\LessonTimesApi::class, 'show'],   'user'],
    ['PUT',    '/api/lesson-times',      [Api\LessonTimesApi::class, 'update'], 'admin'],
    ['GET',    '/api/audit',             [Api\AuditApi::class, 'index'],       'admin'],
    // Ankamon oturum geçmişi (Kullanıcılar ▸ Oturumlar); /active alt çubuk içindir (sayı herkese, liste 'logins'e).
    ['GET',    '/api/login-sessions',    [Api\LoginSessionsApi::class, 'index'],   'logins'],
    ['GET',    '/api/login-sessions/active', [Api\LoginSessionsApi::class, 'active'], 'user'],
    ['GET',    '/api/login-sessions/{id}/actions', [Api\LoginSessionsApi::class, 'actions'], 'logins'],
];
