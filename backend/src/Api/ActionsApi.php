<?php
declare(strict_types=1);

namespace Tihamon\Api;

use Tihamon\Core\Actions;
use Tihamon\Core\Auth;
use Tihamon\Core\Request;

final class ActionsApi
{
    /**
     * Kullanıcının çalıştırmaya yetkili olduğu hazır işlemler. action.json'da "hidden": true olanlar
     * (ör. ahenk-check — kendi sayfasından başlatılır, bkz. page.Ahenk) "Komut çalıştır" listesinde
     * görünmez; görev olarak yine çalıştırılabilir (JobsApi aynı yetkiyi denetler).
     */
    public function index(Request $request, array $user): array
    {
        $allowed = array_filter(Actions::all(),
            static fn($action) => empty($action['hidden']) && Auth::can($user, $action['feature']));
        return ['actions' => array_values($allowed)];
    }
}
