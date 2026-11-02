<?php

declare(strict_types=1);

namespace App\Http\Auth;

use App\Domain\Shared\DomainRuleViolation;
use Laravel\Fortify\Contracts\FailedPasswordResetResponse;

/** A bad, used or expired link, or an address it was not sent to: one code, so none of them can be told apart. */
final class PasswordResetFailedResponse implements FailedPasswordResetResponse
{
    public function toResponse($request): never
    {
        throw new DomainRuleViolation('reset_link_invalid', 'This reset link has expired or was already used.');
    }
}
