<?php

declare(strict_types=1);

namespace App\Providers;

use App\Http\Auth\ResetUserPassword;
use App\Http\Auth\UpdateUserPassword;
use App\Http\Auth\UpdateUserProfileInformation;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;
use Illuminate\Validation\Rules\Password;
use Laravel\Fortify\Fortify;

/** SPA authentication (13 §7): JSON-only Fortify under /api/v1/auth. */
final class FortifyServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        Fortify::resetUserPasswordsUsing(ResetUserPassword::class);
        Fortify::updateUserPasswordsUsing(UpdateUserPassword::class);
        Fortify::updateUserProfileInformationUsing(UpdateUserProfileInformation::class);

        // 04_TRD §4: strong passwords; breached-password check outside tests (it calls an API).
        Password::defaults(fn () => Password::min(12)->letters()->mixedCase()->numbers()
            ->when(! $this->app->runningUnitTests(), fn (Password $p) => $p->uncompromised()));

        RateLimiter::for('login', fn (Request $request) => [
            Limit::perMinute(5)->by(mb_strtolower((string) $request->input(Fortify::username())).'|'.$request->ip()),
            Limit::perMinute(30)->by($request->ip()),
        ]);
        RateLimiter::for('two-factor', fn (Request $request) => Limit::perMinute(5)->by((string) $request->session()->get('login.id')));
    }
}
