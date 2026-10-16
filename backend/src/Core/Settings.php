<?php
declare(strict_types=1);

namespace Tihamon\Core;

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
        // kendiliğinden çalıştırılsın mı (bkz. worker/tihamon/screen/__main__.py). Varsayılan: evet.
        'screen_vnc_autoinstall' => true,
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
