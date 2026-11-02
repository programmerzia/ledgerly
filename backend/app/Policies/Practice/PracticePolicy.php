<?php

declare(strict_types=1);

namespace App\Policies\Practice;

use App\Models\Platform\User;
use Illuminate\Contracts\Auth\Authenticatable;

/** The practice overview lists a person's own memberships, so it is for people only; API tokens are refused (13 §7). */
final class PracticePolicy
{
    public function view(Authenticatable $user): bool
    {
        return $user instanceof User;
    }
}
