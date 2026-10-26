<?php
declare(strict_types=1);

namespace Ankamon\Core;

/**
 * Uzaktan işlem kataloğu: actions/<kimlik>/action.json (+ tahtada çalışacak run.sh).
 * Aynı dizini worker da okur; yeni işlem eklemek için yeni bir alt dizin yeterlidir.
 */
final class Actions
{
    /** @return array<string,array<string,mixed>> kimlik → tanım */
    public static function all(): array
    {
        $dir = getenv('ACTIONS_DIR') ?: '/app/actions';
        $actions = [];
        // Çekirdek işlemleri + eklenti işlemleri (ext/<ad>/actions/<kimlik>; çekirdek eklenti adlarını bilmez).
        $files = array_merge(
            glob($dir . '/*/action.json') ?: [],
            glob(Extensions::dir() . '/*/actions/*/action.json') ?: []
        );
        foreach ($files as $file) {
            $action = json_decode((string) file_get_contents($file), true);
            if (!is_array($action)) {
                error_log("ankamon: okunamayan işlem tanımı: $file");
                continue;
            }
            $id = basename(dirname($file));
            $actions[$id] = $action + [
                'id' => $id, 'description' => '', 'category' => 'Diğer',
                'feature' => 'actions', 'confirm' => false, 'params' => [],
            ];
        }
        uasort($actions, static fn($a, $b) => [$a['category'], $a['title']] <=> [$b['category'], $b['title']]);
        return $actions;
    }

    /**
     * Kullanıcının girdiği değerleri işlem tanımına göre doğrular.
     * @return array<string,string> run.sh'a ortam değişkeni olarak geçecek değerler
     */
    public static function values(array $action, array $input): array
    {
        $values = [];
        foreach ($action['params'] as $param) {
            $key = $param['key'];
            $value = trim((string) ($input[$key] ?? $param['default'] ?? ''));
            if ($value === '' && !empty($param['required'])) {
                throw ApiError::badRequest($param['label'] . ' boş bırakılamaz.');
            }
            if (strlen($value) > 500 || preg_match('/[\x00-\x1f]/', $value)) {
                throw ApiError::badRequest($param['label'] . ' geçersiz karakter içeriyor.');
            }
            $type = $param['type'] ?? 'text';
            if ($value !== '' && $type === 'number' && !ctype_digit($value)) {
                throw ApiError::badRequest($param['label'] . ' sayı olmalı.');
            }
            if ($value !== '' && $type === 'select' && !in_array($value, array_column($param['options'], 'value'), true)) {
                throw ApiError::badRequest($param['label'] . ' için geçersiz seçim.');
            }
            // İsteğe bağlı biçim denetimi (action.json "pattern"/"pattern_error"): tahtaya gitmeden reddet.
            if ($value !== '' && isset($param['pattern'])
                && !preg_match('~' . str_replace('~', '\\~', (string) $param['pattern']) . '~u', $value)) {
                throw ApiError::badRequest($param['label'] . ': ' . ($param['pattern_error'] ?? 'geçersiz biçim.'));
            }
            $values[$key] = $value;
        }
        return $values;
    }

    /**
     * "password" türündeki parametreler gizlidir: değer yalnız görev beklerken/çalışırken jobs.params'ta
     * durur (runner bitince siler — bkz. worker runner _scrub_secrets); API yanıtlarına ve denetim
     * kaydına (audit_log) maskeli kopya yazılır.
     * @param array $params bir "action" görevinin params'ı: {action, values}
     */
    public static function redactParams(array $params): array
    {
        $action = self::all()[(string) ($params['action'] ?? '')] ?? null;
        if ($action === null || !isset($params['values']) || !is_array($params['values'])) {
            return $params;
        }
        foreach ($action['params'] as $param) {
            $key = $param['key'];
            if (($param['type'] ?? 'text') === 'password' && ($params['values'][$key] ?? '') !== '') {
                $params['values'][$key] = '***';
            }
        }
        return $params;
    }
}
