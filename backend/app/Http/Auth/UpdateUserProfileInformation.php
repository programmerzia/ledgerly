<?php

declare(strict_types=1);

namespace App\Http\Auth;

use App\Models\Platform\User;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Laravel\Fortify\Contracts\UpdatesUserProfileInformation;

final class UpdateUserProfileInformation implements UpdatesUserProfileInformation
{
    /** @param array<string, mixed> $input */
    public function update(User $user, array $input): void
    {
        $data = Validator::make($input, [
            'name' => ['required', 'string', 'max:255'],
            'email' => ['required', 'string', 'email:rfc', 'max:255', Rule::unique('users', 'email')->ignore($user->id)],
            'locale' => ['nullable', 'string', 'max:16'],
        ])->validateWithBag('updateProfileInformation');

        $user->forceFill([
            'name' => $data['name'],
            'email' => mb_strtolower((string) $data['email']),
            'locale' => $data['locale'] ?? $user->locale,
        ])->save();
    }
}
