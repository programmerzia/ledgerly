<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Support\Problem\ProblemRenderer;
use Closure;
use Illuminate\Auth\Middleware\RequirePassword;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/** The framework's password confirmation gate, answering in the API's problem shape (13 §16). */
final class RequireConfirmedPassword extends RequirePassword
{
    /**
     * @param  Request  $request
     * @param  string|null  $redirectToRoute
     * @param  string|int|null  $passwordTimeoutSeconds
     */
    public function handle($request, Closure $next, $redirectToRoute = null, $passwordTimeoutSeconds = null): Response
    {
        if ($this->shouldConfirmPassword($request, $passwordTimeoutSeconds === null ? null : (int) $passwordTimeoutSeconds)) {
            return ProblemRenderer::http('password_confirmation_required', 'Confirm your password to continue.', $request);
        }

        return $next($request);
    }
}
