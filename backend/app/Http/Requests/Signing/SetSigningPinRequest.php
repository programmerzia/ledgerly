<?php

declare(strict_types=1);

namespace App\Http\Requests\Signing;

use Illuminate\Foundation\Http\FormRequest;

final class SetSigningPinRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            // Changing the signing PIN re-proves the password; the PIN itself is checked by PinPolicy.
            'current_password' => ['required', 'string', 'current_password:web'],
            'pin' => ['required', 'string', 'digits:6'],
        ];
    }
}
