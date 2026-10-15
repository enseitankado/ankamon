<?php
declare(strict_types=1);

// Tiha-Mon REST API ön denetleyicisi. nginx /api/* isteklerini buraya yollar.

use Tihamon\Core\ApiError;
use Tihamon\Core\Request;
use Tihamon\Core\Router;

spl_autoload_register(static function (string $class): void {
    if (str_starts_with($class, 'Tihamon\\')) {
        require dirname(__DIR__) . '/src/' . str_replace('\\', '/', substr($class, 8)) . '.php';
    }
});

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

try {
    $router = new Router(require dirname(__DIR__) . '/config/routes.php');
    $result = $router->dispatch(new Request());
    echo json_encode($result ?? ['ok' => true], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
} catch (ApiError $e) {
    http_response_code($e->status);
    echo json_encode(['error' => $e->getMessage()], JSON_UNESCAPED_UNICODE);
} catch (Throwable $e) {
    error_log('tiha-mon api: ' . $e);
    http_response_code(500);
    echo json_encode(['error' => 'Sunucu hatası. Ayrıntı sunucu günlüğündedir.'], JSON_UNESCAPED_UNICODE);
}
