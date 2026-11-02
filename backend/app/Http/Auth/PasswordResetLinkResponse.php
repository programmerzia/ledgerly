<?php

declare(strict_types=1);

namespace App\Http\Auth;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Laravel\Fortify\Contracts\FailedPasswordResetLinkRequestResponse;
use Laravel\Fortify\Contracts\SuccessfulPasswordResetLinkRequestResponse;

/**
 * One answer for every outcome of "send me a reset link", so the endpoint does not tell a stranger
 * which addresses have accounts (known, unknown and throttled all read the same).
 */
final class PasswordResetLinkResponse implements FailedPasswordResetLinkRequestResponse, SuccessfulPasswordResetLinkRequestResponse
{
    /** @param Request $request */
    public function toResponse($request): JsonResponse
    {
        return new JsonResponse(['message' => 'If that address has an account, a reset link is on its way.']);
    }
}
