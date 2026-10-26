<?php
declare(strict_types=1);

namespace Ankamon\Core;

/**
 * Yol tablosunu (config/routes.php) isteğe eşler ve yetkiyi denetler.
 *
 * Yol satırı: [METOD, '/api/boards/{id}', [Sınıf::class, 'metot'], erişim]
 * Erişim: 'public' | 'user' (oturum yeter) | 'admin' | bir özellik anahtarı (ör. 'logs').
 */
final class Router
{
    /** @param list<array{0:string,1:string,2:array{0:class-string,1:string},3:string}> $routes */
    public function __construct(private readonly array $routes)
    {
    }

    public function dispatch(Request $request): mixed
    {
        $pathMatched = false;
        foreach ($this->routes as [$method, $pattern, $handler, $access]) {
            $regex = '#^' . preg_replace('#\{(\w+)\}#', '(?P<$1>\d+)', $pattern) . '$#';
            if (!preg_match($regex, $request->path, $matches)) {
                continue;
            }
            $pathMatched = true;
            if ($method !== $request->method) {
                continue;
            }
            $request->args = array_filter($matches, 'is_string', ARRAY_FILTER_USE_KEY);
            $user = $this->authorize($request, $access);
            return (new $handler[0]())->{$handler[1]}($request, $user);
        }
        throw new ApiError($pathMatched ? 405 : 404, $pathMatched ? 'Bu yöntem desteklenmiyor.' : 'Böyle bir uç yok.');
    }

    /** @return array<string,mixed>|null oturum sahibi */
    private function authorize(Request $request, string $access): ?array
    {
        if ($access === 'public') {
            return null;
        }
        // Çerez tabanlı oturumda siteler arası istek sahteciliğine karşı: tarayıcı formları bu başlığı koyamaz.
        if ($request->method !== 'GET' && $request->header('X-Requested-With') !== 'ankamon') {
            throw ApiError::forbidden('Geçersiz istek kaynağı.');
        }
        $user = Auth::user();
        if ($user === null) {
            throw new ApiError(401, 'Oturum açmanız gerekiyor.');
        }
        if ($access === 'admin' && !$user['is_admin']) {
            throw ApiError::forbidden();
        }
        if (!in_array($access, ['user', 'admin'], true) && !Auth::can($user, $access)) {
            throw ApiError::forbidden();
        }
        return $user;
    }
}
