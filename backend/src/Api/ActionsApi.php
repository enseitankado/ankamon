<?php
declare(strict_types=1);

namespace Tihamon\Api;

use Tihamon\Core\Actions;
use Tihamon\Core\Auth;
use Tihamon\Core\Request;

final class ActionsApi
{
    /** Kullanıcının çalıştırmaya yetkili olduğu hazır işlemler. */
    public function index(Request $request, array $user): array
    {
        $allowed = array_filter(Actions::all(), static fn($action) => Auth::can($user, $action['feature']));
        return ['actions' => array_values($allowed)];
    }
}
