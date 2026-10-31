<?php

declare(strict_types=1);

use App\Http\Controllers\Auth\SessionController;
use Illuminate\Support\Facades\Route;

// Auth endpoints (login, 2FA, password) are Fortify's, under /api/v1/auth (config/fortify.php).

// Signed-in SPA user, before a tenant is chosen (13 §7).
Route::middleware('auth:sanctum')->group(function (): void {
    Route::get('me', [SessionController::class, 'me'])->name('session.me');
    Route::put('session/tenant', [SessionController::class, 'switchTenant'])->name('session.tenant');
});

// Tenant routes (2.8+) use: auth:sanctum, tenant, tenant.writable [, company].
