<?php
declare(strict_types=1);

namespace Ankamon\Core;

/**
 * Yüklü eklentiler (ext/<ad>/) ve ayarları. Çekirdek hiçbir eklentiyi adıyla bilmez: her şey
 * EXT_DIR taramasından gelir (bkz. ext/README.md, backend/public/index.php EXT_DIR).
 *
 * Bir eklenti yapılandırılabilir ayarlarını isteğe bağlı bir ext/<ad>/extension.json ile bildirir:
 *   {"title": "...", "description": "...", "settings": [ <action.json "params" biçimi> ]}
 * Şema actions/<kimlik>/action.json "params" ile aynıdır; böylece arayüzde ankamon.ui.Form ve
 * sunucuda Core\Actions::values doğrulaması yeniden kullanılır. Değerler settings tablosunda
 * "ext.<ad>.<key>" anahtarlarıyla durur; eklentiler kendi kodundan Extensions::setting(...) ile okur.
 */
final class Extensions
{
    public static function dir(): string
    {
        return getenv('EXT_DIR') ?: '/opt/ankamon/ext';
    }

    /**
     * Yüklü eklentiler: ad → {name, title, description, version, settings:[şema]}.
     * extension.json yoksa eklenti yine listelenir (settings boş = "ayarı yok").
     * @return array<string,array<string,mixed>>
     */
    public static function all(): array
    {
        $out = [];
        foreach (glob(self::dir() . '/*', GLOB_ONLYDIR) ?: [] as $path) {
            $name = basename($path);
            $meta = self::json($path . '/extension.json');
            $manifest = self::json($path . '/frontend/Manifest.json');
            $settings = (isset($meta['settings']) && is_array($meta['settings'])) ? array_values($meta['settings']) : [];
            $out[$name] = [
                'name' => $name,
                'title' => (string) ($meta['title'] ?? ($manifest['info']['name'] ?? $name)),
                'description' => (string) ($meta['description'] ?? ($manifest['info']['summary'] ?? '')),
                'version' => (string) ($manifest['info']['version'] ?? ''),
                'settings' => $settings,
            ];
        }
        ksort($out);
        return $out;
    }

    /** @return array<string,mixed>|null tek eklenti (ad bilinmiyorsa null) */
    public static function get(string $name): ?array
    {
        return self::all()[$name] ?? null;
    }

    /**
     * Bir eklenti ayarının değeri (settings.ext.<ad>.<key>). Eklentiler kendi backend kodundan bununla okur.
     * @param mixed $default tabloda yoksa dönecek değer
     */
    public static function setting(string $name, string $key, mixed $default = null): mixed
    {
        $value = Settings::get('ext.' . $name . '.' . $key);
        return $value ?? $default;
    }

    private static function json(string $file): array
    {
        if (!is_file($file)) {
            return [];
        }
        $data = json_decode((string) file_get_contents($file), true);
        return is_array($data) ? $data : [];
    }
}
