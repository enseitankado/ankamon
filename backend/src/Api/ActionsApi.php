<?php
/*
 * SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

declare(strict_types=1);

namespace Ankamon\Api;

use Ankamon\Core\Actions;
use Ankamon\Core\ApiError;
use Ankamon\Core\Audit;
use Ankamon\Core\Db;
use Ankamon\Core\Auth;
use Ankamon\Core\Platforms;
use Ankamon\Core\Request;

final class ActionsApi
{
    /**
     * Kullanıcının çalıştırmaya yetkili olduğu hazır işlemler. action.json'da "hidden": true olanlar
     * (ör. ahenk-check — kendi sayfasından başlatılır, bkz. page.Ahenk) "Komut çalıştır" listesinde
     * görünmez; görev olarak yine çalıştırılabilir (JobsApi aynı yetkiyi denetler).
     */
    public function index(Request $request, array $user): array
    {
        $allowed = array_filter(Actions::all(),
            static fn($action) => empty($action['hidden']) && Auth::can($user, $action['feature']));
        return ['actions' => array_values($allowed)];
    }

    /** İşletim sistemine göre işlev tanımı (platforms/catalog.json; bkz. ui.devices.Platforms). */
    public function platforms(Request $request, array $user): array
    {
        return Platforms::catalog();
    }

    /** PowerShell -EncodedCommand'ın cmd.exe satır sınırına (8191) sığması için üst sınır. */
    private const WINDOWS_MAX = 8000;

    /**
     * Hazır işlemi web terminalden uygulamak için cihaz başına tek satırlık komut (kullanıcı isteği 2026-11-23;
     * frontend ui/ssh/TerminalActions). Değerler görevdekiyle AYNI kurallarla doğrulanır (JobsApi::spec — yetki,
     * biçim, yönetici hesabı parolası barikatı); betik hedefin ailesine göre (run.sh / run.ps1 / run.macos.sh).
     * Linux/macOS: ortam değişkenleri + betik gzip+base64 → `printf … | base64 --decode | gunzip | bash -s`
     * (tek satır: etkileşimli kabukta sekme tamamlama / satır satır yorumlama sorunu yok; parola değerleri ekranda
     * açık görünmez). Windows: PowerShell -EncodedCommand. Satır başındaki boşluk HISTCONTROL=ignorespace olan
     * kabukta geçmişe yazılmasını önler. Cihaza araç taşıyan ("tools") ve kendi arayüzü olan ("ui") işlemler
     * terminalden uygulanamaz. Komut logu: kaynak "webshell".
     */
    public function terminal(Request $request, array $user): array
    {
        $id = (string) $request->input('action', '');
        $action = Actions::all()[$id] ?? throw ApiError::badRequest('Bilinmeyen işlem.');
        if (!empty($action['ui'])) {
            throw ApiError::badRequest($action['title'] . ' kendi penceresinde açılır; terminale gönderilmez.');
        }
        if (!empty($action['tools'])) {
            throw ApiError::badRequest($action['title'] . ' cihaza araç kopyaladığı için terminalden uygulanamaz — Komut çalıştır ile görev olarak çalıştırın.');
        }
        $deviceIds = array_values(array_unique(array_map('intval', (array) $request->input('device_ids', []))));
        if (!$deviceIds) {
            throw ApiError::badRequest('Cihaz seçilmedi.');
        }
        [, , $title, $params] = (new JobsApi())->spec(Request::fromBody([
            'type' => 'action', 'action' => $id, 'values' => (array) $request->input('values', []),
        ]), $user);
        $dir = Actions::dir($id) ?? throw ApiError::notFound();
        $families = Platforms::catalog()['families'];
        $placeholders = implode(',', array_fill(0, count($deviceIds), '?'));
        $devices = Db::all("SELECT id, COALESCE(NULLIF(label,''), hostname, host(ip)) AS name, device_os_family(id) AS family
                            FROM devices WHERE id IN ($placeholders)", $deviceIds);
        $byId = array_column($devices, null, 'id');
        $out = [];
        foreach ($deviceIds as $deviceId) {
            $device = $byId[$deviceId] ?? null;
            if ($device === null) {
                $out[] = ['device_id' => $deviceId, 'skipped' => 'Cihaz bulunamadı.'];
                continue;
            }
            $family = (string) $device['family'];
            $def = $families[$family] ?? [];
            $file = !empty($def['script']) ? $dir . '/' . $def['script'] : null;
            if ($file === null || !is_file($file)) {
                $out[] = ['device_id' => $deviceId, 'family' => $family,
                    'skipped' => 'Bu işlemin ' . ($def['label'] ?? $family) . ' uygulaması yok.'];
                continue;
            }
            $text = ($def['shell'] ?? '') === 'powershell'
                ? self::powershellLine((string) file_get_contents($file), $params['values'])
                : self::bashLine((string) file_get_contents($file), $params['values'], $title);
            if ($text === null) {
                $out[] = ['device_id' => $deviceId, 'family' => $family, 'skipped' => 'Betik terminal satırına sığmıyor.'];
                continue;
            }
            Db::exec(
                "INSERT INTO command_log (device_id, device_name, username, source, command, status)
                 VALUES (?, ?, ?, 'webshell', ?, 'ok')",
                [$deviceId, $device['name'], $user['username'], 'Web terminalde hazır komut: ' . $title]
            );
            $out[] = ['device_id' => $deviceId, 'family' => $family, 'text' => $text];
        }
        Audit::log($user, $request, 'device.shell.action', $title . ' — ' . implode(', ', array_column($devices, 'name')));
        return ['title' => $title, 'commands' => $out];
    }

    /** bash: export + betik → gzip+base64 tek satır. */
    private static function bashLine(string $script, array $values, string $title): string
    {
        $env = '';
        foreach ($values as $key => $value) {
            $env .= 'export ' . $key . "='" . str_replace("'", "'\\''", (string) $value) . "'\n";
        }
        $b64 = base64_encode((string) gzencode($env . $script, 9));
        $note = preg_replace('/[^\p{L}\p{N} ._()\/-]/u', '', $title);
        return " printf %s '$b64' | base64 --decode | gunzip | bash -s  # Ankamon hazır komut: $note";
    }

    /** PowerShell: $env: + betik → -EncodedCommand (UTF-16LE base64); sığmazsa null. */
    private static function powershellLine(string $script, array $values): ?string
    {
        $env = '';
        foreach ($values as $key => $value) {
            $env .= '$env:' . $key . " = '" . str_replace("'", "''", (string) $value) . "'\n";
        }
        $b64 = base64_encode((string) mb_convert_encoding($env . $script, 'UTF-16LE', 'UTF-8'));
        $line = 'powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ' . $b64;
        return strlen($line) > self::WINDOWS_MAX ? null : $line;
    }
}
