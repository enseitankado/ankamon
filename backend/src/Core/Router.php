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
