<?php

declare(strict_types=1);

namespace App\Http\Auth;

use Illuminate\Validation\Rules\Password;

/** One password policy for sign-up, reset and change (04_TRD §4). */
final class PasswordRules
{
    /** @return list<mixed> */
    public static function rules(): array
    {
        return ['required', 'string', Password::defaults(), 'confirmed'];
    }
}
