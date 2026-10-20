<?php
declare(strict_types=1);

// Tiha-Mon REST API ön denetleyicisi. nginx /api/* isteklerini buraya yollar.

use Tihamon\Core\ApiError;
use Tihamon\Core\Request;
use Tihamon\Core\Router;

const EXT_DIR = '/opt/tiha-mon/ext';

spl_autoload_register(static function (string $class): void {
    if (str_starts_with($class, 'Tihamon\\')) {
        require dirname(__DIR__) . '/src/' . str_replace('\\', '/', substr($class, 8)) . '.php';
    } elseif (str_starts_with($class, 'TihamonExt\\')) {
        // Eklenti sınıfı: TihamonExt\<Ad>\Yol\Sinif → ext/<ad>/backend/src/Yol/Sinif.php (bkz. ext/README.md).
        $parts = explode('\\', substr($class, 11), 2);
        if (count($parts) === 2) {
            $file = EXT_DIR . '/' . strtolower($parts[0]) . '/backend/src/' . str_replace('\\', '/', $parts[1]) . '.php';
            if (is_file($file)) {
                require $file;
            }
        }
    }
});

// Eklentiler (public depoda yok): her ext/<ad>/backend/routes.php, config/routes.php ile aynı biçimde rota
// dizisi döndürür ve çekirdek rotalarının ardına eklenir. Eklenti yoksa liste değişmez.
function tihamon_routes(): array
{
    $routes = require dirname(__DIR__) . '/config/routes.php';
    foreach (glob(EXT_DIR . '/*/backend/routes.php') ?: [] as $file) {
        $routes = array_merge($routes, require $file);
    }
    return $routes;
}

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

try {
    $router = new Router(tihamon_routes());
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
