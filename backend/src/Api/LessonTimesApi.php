<?php
declare(strict_types=1);

namespace Tihamon\Api;

use Tihamon\Core\ApiError;
use Tihamon\Core\Audit;
use Tihamon\Core\Request;
use Tihamon\Core\Settings;

/**
 * Okulun ders saatleri (Ayarlar ▸ Ders saatleri — yalnız yönetici yazar). Okuma her oturum açmış
 * kullanıcıya açıktır: Oturumlar ▸ Kullanıcılar çizelgesi oturum çubuğunun ipucunda oturumun hangi
 * derslere denk geldiğini gösterir (bkz. frontend ui.sessions.Users). Saatler sunucunun saat diliminde
 * (TZ) yerel saattir; ders günleri dışındaki günlere uygulanmaz.
 */
final class LessonTimesApi
{
    private const MAX_LESSONS = 20;

    public function show(): array
    {
        return Settings::get('lesson_times');
    }

    public function update(Request $request, array $user): array
    {
        $days = array_values(array_unique(array_filter(
            array_map('intval', (array) $request->input('days', [])),
            fn(int $d) => $d >= 1 && $d <= 7
        )));
        sort($days);
        $lessons = [];
        foreach ((array) $request->input('lessons', []) as $i => $row) {
            $start = self::time($row['start'] ?? null);
            $end = self::time($row['end'] ?? null);
            $no = $i + 1;
            if ($start === null || $end === null) {
                throw new ApiError(422, "$no. satır: başlangıç ve bitiş SS:DD biçiminde olmalı (ör. 08:30).");
            }
            if ($end <= $start) {
                throw new ApiError(422, "$no. satır: bitiş ($end) başlangıçtan ($start) sonra olmalı.");
            }
            $name = trim((string) ($row['name'] ?? ''));
            $lessons[] = ['name' => mb_substr($name !== '' ? $name : "$no. ders", 0, 40), 'start' => $start, 'end' => $end];
        }
        if (count($lessons) > self::MAX_LESSONS) {
            throw new ApiError(422, 'En çok ' . self::MAX_LESSONS . ' ders saati tanımlanabilir.');
        }
        usort($lessons, fn($a, $b) => strcmp($a['start'], $b['start']));
        for ($i = 1; $i < count($lessons); $i++) {
            if ($lessons[$i]['start'] < $lessons[$i - 1]['end']) {
                throw new ApiError(422, "\"{$lessons[$i - 1]['name']}\" ile \"{$lessons[$i]['name']}\" çakışıyor.");
            }
        }
        $value = ['days' => $days, 'lessons' => $lessons];
        Settings::set('lesson_times', $value);
        Audit::log($user, $request, 'settings.update', 'lesson_times');
        return $value;
    }

    /** "8:5" / "08:05" → "08:05"; geçersizse null. */
    private static function time(mixed $value): ?string
    {
        if (!is_string($value) || !preg_match('/^\s*(\d{1,2}):(\d{1,2})\s*$/', $value, $m)) {
            return null;
        }
        [$h, $i] = [(int) $m[1], (int) $m[2]];
        return $h <= 23 && $i <= 59 ? sprintf('%02d:%02d', $h, $i) : null;
    }
}
