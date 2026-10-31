<?php

declare(strict_types=1);

namespace App\Models\Platform;

use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Fortify\TwoFactorAuthenticatable;
use Spatie\Permission\Traits\HasRoles;

#[Hidden(['password', 'remember_token', 'two_factor_secret', 'two_factor_recovery_codes', 'signing_pin_hash'])]
class User extends Authenticatable
{
    use HasRoles;
    use Notifiable;
    use TwoFactorAuthenticatable;

    public $incrementing = false;

    protected $keyType = 'string';

    protected $guarded = [];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'email_verified_at' => 'immutable_datetime',
            'password' => 'hashed',
            'signing_locked_until' => 'immutable_datetime',
        ];
    }
}
