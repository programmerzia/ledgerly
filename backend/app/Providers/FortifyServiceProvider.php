<?php

declare(strict_types=1);

namespace App\Providers;

use App\Http\Auth\CreateNewUser;
use App\Http\Auth\PasswordResetFailedResponse;
use App\Http\Auth\PasswordResetLinkResponse;
use App\Http\Auth\ResetUserPassword;
use App\Http\Auth\UpdateUserPassword;
use App\Http\Auth\UpdateUserProfileInformation;
use App\Http\Docs\FortifyOperationDocs;
use App\Http\Docs\SchemaCorrections;
use App\Models\Platform\User;
use Dedoc\Scramble\Scramble;
use Dedoc\Scramble\Support\Generator\OpenApi;
use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;
use Illuminate\Validation\Rules\Password;
use Laravel\Fortify\Contracts\FailedPasswordResetLinkRequestResponse;
use Laravel\Fortify\Contracts\FailedPasswordResetResponse;
use Laravel\Fortify\Contracts\SuccessfulPasswordResetLinkRequestResponse;
use Laravel\Fortify\Fortify;

/** SPA authentication (13 §7): JSON-only Fortify under /api/v1/auth. */
final class FortifyServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->bind(SuccessfulPasswordResetLinkRequestResponse::class, PasswordResetLinkResponse::class);
        $this->app->bind(FailedPasswordResetLinkRequestResponse::class, PasswordResetLinkResponse::class);
        $this->app->bind(FailedPasswordResetResponse::class, PasswordResetFailedResponse::class);
    }

    public function boot(): void
    {
        // Fortify's vendor controllers are not readable by Scramble; document them explicitly.
        Scramble::configure()->withOperationTransformers(FortifyOperationDocs::class);
        // Scramble still derives a component from Fortify's LoginRequest before the override; nothing refers to it any more.
        Scramble::afterOpenApiGenerated(fn (OpenApi $openApi) => $openApi->components->removeSchema('LoginRequest'));
        Scramble::afterOpenApiGenerated(new SchemaCorrections);

        Fortify::createUsersUsing(CreateNewUser::class);
        Fortify::resetUserPasswordsUsing(ResetUserPassword::class);
        // Views are off; the reset link opens the SPA's /reset-password/{token} (02_AppFlow §2).
        ResetPassword::createUrlUsing(fn (User $user, string $token): string => rtrim((string) config('app.frontend_url'), '/')
            .'/reset-password/'.$token.'?email='.urlencode($user->email));
        Fortify::updateUserPasswordsUsing(UpdateUserPassword::class);
        Fortify::updateUserProfileInformationUsing(UpdateUserProfileInformation::class);

        // 04_TRD §4: strong passwords; breached-password check outside tests (it calls an API).
        Password::defaults(fn () => Password::min(12)->letters()->mixedCase()->numbers()
            ->when(! $this->app->runningUnitTests(), fn (Password $p) => $p->uncompromised()));

        RateLimiter::for('login', fn (Request $request) => [
            Limit::perMinute(5)->by(mb_strtolower((string) $request->input(Fortify::username())).'|'.$request->ip()),
            Limit::perMinute(30)->by($request->ip()),
        ]);
        // PIN guesses: the lockout is the real defence; this keeps a scripted attacker slow.
        RateLimiter::for('signing', fn (Request $request) => Limit::perMinute(10)->by((string) ($request->user()?->getAuthIdentifier() ?? $request->ip())));
        RateLimiter::for('invitations', fn (Request $request) => Limit::perMinute(20)->by((string) $request->ip()));
        // Public online invoice pages (plan 3c.7b): by address, not by token, so guessing tokens is as slow as it is hopeless.
        RateLimiter::for('public-invoice', fn (Request $request) => Limit::perMinute(60)->by('public-invoice:'.$request->ip()));
        RateLimiter::for('public-invoice-pdf', fn (Request $request) => Limit::perMinute(90)->by('public-invoice-pdf:'.$request->ip()));
        RateLimiter::for('register', fn (Request $request) => Limit::perHour(10)->by((string) $request->ip()));
        RateLimiter::for('two-factor', fn (Request $request) => Limit::perMinute(5)->by((string) $request->session()->get('login.id')));
    }
}
