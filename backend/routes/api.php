<?php

declare(strict_types=1);

use App\Http\Controllers\Auth\SessionController;
use App\Http\Controllers\Fiscal\FiscalPeriodController;
use App\Http\Controllers\Fiscal\FiscalYearController;
use App\Http\Controllers\Fiscal\ReopenRequestController;
use App\Http\Controllers\Ledger\AccountController;
use App\Http\Controllers\Ledger\ChartTemplateController;
use App\Http\Controllers\Ledger\DimensionController;
use App\Http\Controllers\Ledger\JournalController;
use App\Http\Controllers\Organisation\CompanyController;
use App\Http\Controllers\Organisation\InvitationController;
use App\Http\Controllers\Organisation\InvitationTokenController;
use App\Http\Controllers\Signing\SigningController;
use App\Http\Controllers\Workflow\ApprovalInboxController;
use App\Http\Controllers\Workflow\ApprovalWorkflowController;
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
Route::middleware(['auth:sanctum', 'tenant', 'tenant.writable', 'idempotent'])->group(function (): void {
    Route::get('companies', [CompanyController::class, 'index'])->name('companies.index');
    Route::post('companies', [CompanyController::class, 'store'])->name('companies.store');
    Route::get('invitations', [InvitationController::class, 'index'])->name('invitations.index');
    Route::post('invitations', [InvitationController::class, 'store'])->name('invitations.store');
    Route::delete('invitations/{invitation}', [InvitationController::class, 'destroy'])->whereUuid('invitation')->name('invitations.destroy');

    // Signing PIN (ADR-0004): grants are per user and session, so these need the SPA session.
    Route::put('signing/pin', [SigningController::class, 'setPin'])->name('signing.pin');
    Route::post('signing/verify', [SigningController::class, 'verify'])->name('signing.verify');
    Route::delete('signing/grant', [SigningController::class, 'revoke'])->name('signing.revoke');
});

// Company routes: a person (session) or an API client (bearer token) working inside one company of the tenant.
// `company` resolves and checks access first; ids of every other resource are bound inside that company
// (App\Http\Support\CompanyBindings), so another company's id is a 404. Throttled per principal (13 §16).
Route::middleware(['auth:sanctum', 'tenant', 'tenant.writable', 'idempotent', 'company', 'throttle:company-api'])
    ->prefix('companies/{company}')->whereUuid('company')->group(function (): void {
        // Chart of accounts
        Route::get('chart-templates', [ChartTemplateController::class, 'index'])->name('chart-templates.index');
        Route::post('apply-chart-template', [ChartTemplateController::class, 'apply'])->name('chart-templates.apply');
        Route::get('accounts', [AccountController::class, 'index'])->name('accounts.index');
        Route::post('accounts', [AccountController::class, 'store'])->name('accounts.store');
        Route::get('accounts/{account}', [AccountController::class, 'show'])->whereUuid('account')->name('accounts.show');
        Route::put('accounts/{account}', [AccountController::class, 'update'])->whereUuid('account')->name('accounts.update');
        Route::post('accounts/{account}/deactivate', [AccountController::class, 'deactivate'])->whereUuid('account')->name('accounts.deactivate');
        Route::put('accounts/{account}/dimension-rules', [AccountController::class, 'setDimensionRules'])->whereUuid('account')->name('accounts.dimension-rules');

        // Dimensions
        Route::get('dimensions', [DimensionController::class, 'index'])->name('dimensions.index');
        Route::post('dimensions', [DimensionController::class, 'store'])->name('dimensions.store');
        Route::put('dimensions/{dimension}', [DimensionController::class, 'update'])->whereUuid('dimension')->name('dimensions.update');
        Route::post('dimensions/{dimension}/deactivate', [DimensionController::class, 'deactivate'])->whereUuid('dimension')->name('dimensions.deactivate');
        Route::post('dimensions/{dimension}/values', [DimensionController::class, 'storeValue'])->whereUuid('dimension')->name('dimensions.values.store');
        Route::put('dimensions/{dimension}/values/{dimensionValue}', [DimensionController::class, 'updateValue'])->whereUuid(['dimension', 'dimensionValue'])->name('dimensions.values.update');
        Route::post('dimensions/{dimension}/values/{dimensionValue}/deactivate', [DimensionController::class, 'deactivateValue'])->whereUuid(['dimension', 'dimensionValue'])->name('dimensions.values.deactivate');

        // Fiscal years and periods
        Route::get('fiscal-years', [FiscalYearController::class, 'index'])->name('fiscal-years.index');
        Route::post('fiscal-years', [FiscalYearController::class, 'store'])->name('fiscal-years.store');
        Route::post('fiscal-years/{fiscalYear}/year-end-close', [FiscalYearController::class, 'yearEnd'])->whereUuid('fiscalYear')->name('fiscal-years.year-end');
        Route::post('fiscal-years/{fiscalYear}/lock', [FiscalYearController::class, 'lock'])->whereUuid('fiscalYear')->name('fiscal-years.lock');
        Route::post('fiscal-periods/{fiscalPeriod}/soft-close', [FiscalPeriodController::class, 'softClose'])->whereUuid('fiscalPeriod')->name('fiscal-periods.soft-close');
        Route::get('fiscal-periods/{fiscalPeriod}/close-checks', [FiscalPeriodController::class, 'checks'])->whereUuid('fiscalPeriod')->name('fiscal-periods.close-checks');
        Route::post('fiscal-periods/{fiscalPeriod}/close', [FiscalPeriodController::class, 'close'])->whereUuid('fiscalPeriod')->name('fiscal-periods.close');
        Route::post('fiscal-periods/{fiscalPeriod}/reopen-requests', [FiscalPeriodController::class, 'requestReopen'])->whereUuid('fiscalPeriod')->name('fiscal-periods.reopen-requests.store');
        Route::post('reopen-requests/{reopenRequest}/approve', [ReopenRequestController::class, 'approve'])->whereUuid('reopenRequest')->name('reopen-requests.approve');
        Route::post('reopen-requests/{reopenRequest}/reject', [ReopenRequestController::class, 'reject'])->whereUuid('reopenRequest')->name('reopen-requests.reject');

        // Journals and their transitions (13 §16)
        Route::get('journals', [JournalController::class, 'index'])->name('journals.index');
        Route::post('journals', [JournalController::class, 'store'])->name('journals.store');
        Route::get('journals/{journal}', [JournalController::class, 'show'])->whereUuid('journal')->name('journals.show');
        Route::put('journals/{journal}', [JournalController::class, 'update'])->whereUuid('journal')->name('journals.update');
        Route::post('journals/{journal}/posting-preview', [JournalController::class, 'preview'])->whereUuid('journal')->name('journals.preview');
        Route::post('journals/{journal}/submit', [JournalController::class, 'submit'])->whereUuid('journal')->name('journals.submit');
        Route::post('journals/{journal}/approve', [JournalController::class, 'approve'])->whereUuid('journal')->name('journals.approve');
        Route::post('journals/{journal}/return', [JournalController::class, 'return'])->whereUuid('journal')->name('journals.return');
        Route::post('journals/{journal}/void', [JournalController::class, 'void'])->whereUuid('journal')->name('journals.void');
        Route::post('journals/{journal}/reverse', [JournalController::class, 'reverse'])->whereUuid('journal')->name('journals.reverse');

        // Approvals: the inbox, and the workflows that feed it (settings.manage)
        Route::get('approvals', [ApprovalInboxController::class, 'index'])->name('approvals.index');
        Route::get('approval-workflows', [ApprovalWorkflowController::class, 'index'])->name('approval-workflows.index');
        Route::post('approval-workflows', [ApprovalWorkflowController::class, 'store'])->name('approval-workflows.store');
        Route::put('approval-workflows/{workflow}', [ApprovalWorkflowController::class, 'update'])->whereUuid('workflow')->name('approval-workflows.update');
        Route::post('approval-workflows/{workflow}/deactivate', [ApprovalWorkflowController::class, 'deactivate'])->whereUuid('workflow')->name('approval-workflows.deactivate');
    });
