<?php

declare(strict_types=1);

namespace App\Http\Auth;

use App\Models\Platform\User;
use Illuminate\Support\Facades\Validator;
use Laravel\Fortify\Contracts\UpdatesUserPasswords;

final class UpdateUserPassword implements UpdatesUserPasswords
{
    /** @param array<string, mixed> $input */
    public function update(User $user, array $input): void
    {
        Validator::make($input, [
            'current_password' => ['required', 'string', 'current_password:web'],
            'password' => PasswordRules::rules(),
        ])->validateWithBag('updatePassword');

        $user->forceFill(['password' => $input['password']])->save();
    }
}
