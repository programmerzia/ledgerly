<?php

declare(strict_types=1);

namespace App\Http\Auth;

use App\Models\Platform\User;
use Illuminate\Support\Facades\Validator;
use Laravel\Fortify\Contracts\ResetsUserPasswords;

final class ResetUserPassword implements ResetsUserPasswords
{
    /** @param array<string, mixed> $input */
    public function reset(User $user, array $input): void
    {
        Validator::make($input, ['password' => PasswordRules::rules()])->validate();

        $user->forceFill(['password' => $input['password']])->save();
    }
}
