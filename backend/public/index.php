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

// Ankamon REST API ön denetleyicisi. nginx /api/* isteklerini buraya yollar.

use Ankamon\Core\ApiError;
use Ankamon\Core\Request;
use Ankamon\Core\Router;

const EXT_DIR = '/opt/ankamon/ext';

spl_autoload_register(static function (string $class): void {
    if (str_starts_with($class, 'Ankamon\\')) {
        require dirname(__DIR__) . '/src/' . str_replace('\\', '/', substr($class, 8)) . '.php';
    } elseif (str_starts_with($class, 'AnkamonExt\\')) {
        // Eklenti sınıfı: AnkamonExt\<Ad>\Yol\Sinif → ext/<ad>/backend/src/Yol/Sinif.php (bkz. ext/README.md).
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
function ankamon_routes(): array
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
    $router = new Router(ankamon_routes());
    $result = $router->dispatch(new Request());
    echo json_encode($result ?? ['ok' => true], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
} catch (ApiError $e) {
    http_response_code($e->status);
    echo json_encode(['error' => $e->getMessage()], JSON_UNESCAPED_UNICODE);
} catch (Throwable $e) {
    error_log('ankamon api: ' . $e);
    http_response_code(500);
    echo json_encode(['error' => 'Sunucu hatası. Ayrıntı sunucu günlüğündedir.'], JSON_UNESCAPED_UNICODE);
}
