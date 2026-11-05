<?php

declare(strict_types=1);

namespace App\Policies\Notifications;

use App\Models\Platform\User;
use Illuminate\Contracts\Auth\Authenticatable;

/** The bell: any signed-in person of the company, for their own notifications only (the Query filters on them). Tokens never. */
final class UserNotificationPolicy
{
    public function viewAny(Authenticatable $principal): bool
    {
        return $principal instanceof User;
    }
}
