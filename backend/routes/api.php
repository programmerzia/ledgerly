<?php

declare(strict_types=1);

use App\Http\Controllers\Auth\SessionController;
use App\Http\Controllers\Organisation\CompanyController;
use App\Http\Controllers\Organisation\InvitationController;
use App\Http\Controllers\Organisation\InvitationTokenController;
use Illuminate\Support\Facades\Route;
use Laravel\Fortify\Http\Controllers\RegisteredUserController;

// Auth endpoints (login, 2FA, password) are Fortify's, under /api/v1/auth (config/fortify.php).
// Sign-up uses Fortify's controller (→ App\Http\Auth\CreateNewUser) with its own rate limit.
Route::post('auth/register', [RegisteredUserController::class, 'store'])
    ->middleware(['guest:web', 'throttle:register'])->name('register.store');

// Invitation links, before any tenant is chosen: preview, then accept (signed in or as a new account).
Route::middleware('throttle:invitations')->group(function (): void {
    Route::get('invitation-tokens/{token}', [InvitationTokenController::class, 'show'])->name('invitation-tokens.show');
    Route::post('invitation-tokens/{token}/accept', [InvitationTokenController::class, 'accept'])->name('invitation-tokens.accept');
});

// Signed-in SPA user, before a tenant is chosen (13 §7).
Route::middleware('auth:sanctum')->group(function (): void {
    Route::get('me', [SessionController::class, 'me'])->name('session.me');
    Route::put('session/tenant', [SessionController::class, 'switchTenant'])->name('session.tenant');
});

// Organisation-level routes: a signed-in user inside a resolved tenant, no company yet.
Route::middleware(['auth:sanctum', 'tenant', 'tenant.writable'])->group(function (): void {
    Route::get('companies', [CompanyController::class, 'index'])->name('companies.index');
    Route::post('companies', [CompanyController::class, 'store'])->name('companies.store');
    Route::get('invitations', [InvitationController::class, 'index'])->name('invitations.index');
    Route::post('invitations', [InvitationController::class, 'store'])->name('invitations.store');
    Route::delete('invitations/{invitation}', [InvitationController::class, 'destroy'])->whereUuid('invitation')->name('invitations.destroy');
});

// Tenant routes (2.8+) use: auth:sanctum, tenant, tenant.writable [, company].
