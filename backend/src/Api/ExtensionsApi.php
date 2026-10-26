<?php
declare(strict_types=1);

namespace Ankamon\Api;

use Ankamon\Core\Actions;
use Ankamon\Core\ApiError;
use Ankamon\Core\Audit;
use Ankamon\Core\Extensions;
use Ankamon\Core\Request;
use Ankamon\Core\Settings;

/**
 * Yüklü eklentiler ve ayarları — yalnız yönetici. Çekirdek eklentileri adıyla bilmez; EXT_DIR taranır
 * (bkz. Core\Extensions). Ayar şeması action.json "params" biçimindedir → doğrulama Core\Actions ile
 * ortaktır. Parolalar yanıtta maskelenir ('***'); kaydederken '***' / boş gelen parola "değiştirme"dir.
 */
final class ExtensionsApi
{
    public function list(Request $request, array $user): array
    {
        $out = [];
        foreach (Extensions::all() as $name => $ext) {
            $ext['values'] = self::readValues($name, $ext['settings']);
            $out[] = $ext;
        }
        return ['extensions' => $out];
    }

    /** Eklentilerin etkin/pasif durumu (ad → bool); 'user' erişimi — frontend sekmeleri buna göre gösterir. */
    public function active(Request $request, array $user): array
    {
        $out = [];
        foreach (Extensions::all() as $name => $ext) {
            $out[$name] = Extensions::setting($name, 'enabled', true) !== false;
        }
        return ['active' => (object) $out];
    }

    public function saveSettings(Request $request, array $user): array
    {
        $name = (string) $request->input('name');
        $ext = Extensions::get($name);
        if ($ext === null) {
            throw ApiError::badRequest('Bilinmeyen eklenti.');
        }
        if (!$ext['settings']) {
            throw ApiError::badRequest('Bu eklentinin ayarı yok.');
        }
        $input = is_array($request->input('values')) ? $request->input('values') : [];

        // Parola alanı: maske ('***') ya da boş gelirse mevcut değer korunur (bkz. SettingsApi samba).
        foreach ($ext['settings'] as $param) {
            if (($param['type'] ?? 'text') === 'password') {
                $sent = (string) ($input[$param['key']] ?? '');
                if ($sent === '' || $sent === '***') {
                    $input[$param['key']] = (string) (Settings::get('ext.' . $name . '.' . $param['key']) ?? '');
                }
            }
        }

        // action.json "params" ile aynı şema → aynı doğrulama (required, number, select, pattern).
        $values = Actions::values(['params' => $ext['settings']], $input);

        foreach ($ext['settings'] as $param) {
            $key = $param['key'];
            $type = $param['type'] ?? 'text';
            $value = $values[$key] ?? '';
            if ($type === 'checkbox') {
                $value = $value !== '' && $value !== '0' && $value !== 'false';
            } elseif ($type === 'number' && $value !== '') {
                $value = (int) $value;
            }
            Settings::set('ext.' . $name . '.' . $key, $value);
        }
        Audit::log($user, $request, 'extensions.settings', $name);
        return ['ok' => true];
    }

    /** Şemadaki her alan için saklı değer (yoksa varsayılan); parolalar maskeli. */
    private static function readValues(string $name, array $settings): array
    {
        $values = [];
        foreach ($settings as $param) {
            $key = $param['key'];
            $stored = Settings::get('ext.' . $name . '.' . $key);
            if (($param['type'] ?? 'text') === 'password') {
                $values[$key] = ($stored !== null && $stored !== '') ? '***' : '';
            } else {
                $values[$key] = $stored ?? ($param['default'] ?? '');
            }
        }
        return $values;
    }
}
