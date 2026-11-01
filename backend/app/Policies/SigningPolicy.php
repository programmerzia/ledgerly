<?php

declare(strict_types=1);

namespace App\Policies;

use App\Models\Platform\User;
use Illuminate\Contracts\Auth\Authenticatable;

/** Any signed-in person may manage their own PIN; API clients never sign (ADR-0004). */
final class SigningPolicy
{
    public function sign(Authenticatable $user): bool
    {
        return $user instanceof User;
    }
}
