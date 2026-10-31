<?php

declare(strict_types=1);

namespace App\Policies;

use App\Models\Platform\User;

/** Any signed-in person may manage their own PIN; API clients never sign (ADR-0004). */
final class SigningPolicy
{
    public function sign(User $user): bool
    {
        return true;
    }
}
