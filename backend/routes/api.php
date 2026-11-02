<?php

declare(strict_types=1);

use App\Http\Controllers\Audit\AuditController;
use App\Http\Controllers\Auth\SessionController;
use App\Http\Controllers\Banking\BankAccountController;
use App\Http\Controllers\Banking\BankMatchingController;
use App\Http\Controllers\Banking\BankReconciliationController;
use App\Http\Controllers\Banking\BankRuleController;
use App\Http\Controllers\Files\AttachmentBlobController;
use App\Http\Controllers\Files\AttachmentController;
use App\Http\Controllers\Fiscal\FiscalPeriodController;
use App\Http\Controllers\Fiscal\FiscalYearController;
use App\Http\Controllers\Fiscal\ReopenRequestController;
use App\Http\Controllers\Fx\ExchangeRateController;
use App\Http\Controllers\Fx\FxRevaluationController;
use App\Http\Controllers\Imports\ImportController;
use App\Http\Controllers\Ledger\AccountController;
use App\Http\Controllers\Ledger\ChartTemplateController;
use App\Http\Controllers\Ledger\DimensionController;
use App\Http\Controllers\Ledger\JournalController;
use App\Http\Controllers\Organisation\ApiClientController;
use App\Http\Controllers\Organisation\CompanyController;
use App\Http\Controllers\Organisation\CompanySettingsController;
use App\Http\Controllers\Organisation\InvitationController;
use App\Http\Controllers\Organisation\InvitationTokenController;
use App\Http\Controllers\Organisation\MemberController;
use App\Http\Controllers\Practice\PracticeController;
use App\Http\Controllers\Recurring\RecurringInvoiceController;
use App\Http\Controllers\Recurring\RecurringJournalController;
use App\Http\Controllers\Recurring\RecurringRunController;
use App\Http\Controllers\Reports\ReportController;
use App\Http\Controllers\Reports\ReportExportController;
use App\Http\Controllers\Signing\SigningController;
use App\Http\Controllers\Tax\TaxCodeController;
use App\Http\Controllers\Tax\TaxGroupController;
use App\Http\Controllers\Trade\BillController;
use App\Http\Controllers\Trade\ContactController;
use App\Http\Controllers\Trade\CreditApplicationController;
use App\Http\Controllers\Trade\InvoiceController;
use App\Http\Controllers\Trade\ItemController;
use App\Http\Controllers\Trade\PaymentRunController;
use App\Http\Controllers\Trade\SettlementController;
use App\Http\Controllers\Trade\WhtCertificateController;
use App\Http\Controllers\Webhooks\WebhookEndpointController;
use App\Http\Controllers\Workflow\ApprovalInboxController;
use App\Http\Controllers\Workflow\ApprovalWorkflowController;
use App\Services\Reports\ReportExport;
use Illuminate\Foundation\Http\Middleware\ValidateCsrfToken;
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
    // Firm access: client organisations (and their companies) the user belongs to, with key figures.
    Route::get('practice/overview', [PracticeController::class, 'overview'])->name('practice.overview');
});

// Organisation-level routes: a signed-in user inside a resolved tenant, no company yet.
Route::middleware(['auth:sanctum', 'tenant', 'tenant.writable', 'idempotent'])->group(function (): void {
    Route::get('companies', [CompanyController::class, 'index'])->name('companies.index');
    Route::post('companies', [CompanyController::class, 'store'])->name('companies.store');
    Route::get('invitations', [InvitationController::class, 'index'])->name('invitations.index');
    Route::post('invitations', [InvitationController::class, 'store'])->name('invitations.store');
    Route::delete('invitations/{invitation}', [InvitationController::class, 'destroy'])->whereUuid('invitation')->name('invitations.destroy');

    // API clients and their tokens (owners and admins, people only); a token's secret is shown once
    Route::get('api-clients', [ApiClientController::class, 'index'])->name('api-clients.index');
    Route::post('api-clients', [ApiClientController::class, 'store'])->name('api-clients.store');
    Route::post('api-clients/{apiClient}/tokens', [ApiClientController::class, 'issueToken'])->whereUuid('apiClient')->name('api-clients.tokens.store');
    Route::post('api-clients/{apiClient}/revoke', [ApiClientController::class, 'revoke'])->whereUuid('apiClient')->name('api-clients.revoke');

    // People and roles of the organisation (owners and admins)
    Route::get('members', [MemberController::class, 'index'])->name('members.index');

    // Webhook endpoints are organisation-level (13 §15, §7): owners and admins, people only.
    Route::get('webhook-endpoints', [WebhookEndpointController::class, 'index'])->name('webhook-endpoints.index');
    Route::post('webhook-endpoints', [WebhookEndpointController::class, 'store'])->name('webhook-endpoints.store');
    Route::put('webhook-endpoints/{webhook}', [WebhookEndpointController::class, 'update'])->whereUuid('webhook')->name('webhook-endpoints.update');
    Route::post('webhook-endpoints/{webhook}/rotate-secret', [WebhookEndpointController::class, 'rotateSecret'])->whereUuid('webhook')->name('webhook-endpoints.rotate-secret');
    Route::post('webhook-endpoints/{webhook}/disable', [WebhookEndpointController::class, 'disable'])->whereUuid('webhook')->name('webhook-endpoints.disable');
    Route::post('webhook-endpoints/{webhook}/enable', [WebhookEndpointController::class, 'enable'])->whereUuid('webhook')->name('webhook-endpoints.enable');
    Route::get('webhook-endpoints/{webhook}/deliveries', [WebhookEndpointController::class, 'deliveries'])->whereUuid('webhook')->name('webhook-endpoints.deliveries');
    Route::post('webhook-endpoints/{webhook}/deliveries/{delivery}/redeliver', [WebhookEndpointController::class, 'redeliver'])->whereUuid(['webhook', 'delivery'])->name('webhook-endpoints.redeliver');

    // Signing PIN (ADR-0004): grants are per user and session, so these need the SPA session.
    Route::put('signing/pin', [SigningController::class, 'setPin'])->name('signing.pin');
    Route::post('signing/verify', [SigningController::class, 'verify'])->name('signing.verify');
    Route::delete('signing/grant', [SigningController::class, 'revoke'])->name('signing.revoke');
});

// Local-disk "presigned" attachment URLs (13 §17): no session or token, the URL signature and expiry are the credential.
Route::middleware(['signed', 'throttle:120,1'])->withoutMiddleware(ValidateCsrfToken::class)->whereUuid(['tenant', 'file'])->group(function (): void {
    Route::put('attachment-uploads/{tenant}/{file}', [AttachmentBlobController::class, 'put'])->name('attachment-uploads.put');
    Route::get('attachment-files/{tenant}/{file}', [AttachmentBlobController::class, 'show'])->name('attachment-files.show');
});

// Company routes: a person (session) or an API client (bearer token) working inside one company of the tenant.
// `company` resolves and checks access first; ids of every other resource are bound inside that company
// (App\Http\Support\CompanyBindings), so another company's id is a 404. Throttled per principal (13 §16).
Route::middleware(['auth:sanctum', 'tenant', 'tenant.writable', 'idempotent', 'company', 'throttle:company-api'])
    ->prefix('companies/{company}')->whereUuid('company')->group(function (): void {
        // Roles of the company and who holds them (org owners and admins)
        Route::get('roles', [MemberController::class, 'roles'])->name('roles.index');
        Route::put('members/{user}/roles/{role}', [MemberController::class, 'assign'])->whereUuid(['user', 'role'])->name('members.roles.assign');
        Route::delete('members/{user}/roles/{role}', [MemberController::class, 'revoke'])->whereUuid(['user', 'role'])->name('members.roles.revoke');

        // Company profile, tax rounding and posting accounts
        Route::get('settings', [CompanySettingsController::class, 'show'])->name('settings.show');
        Route::put('settings', [CompanySettingsController::class, 'update'])->name('settings.update');

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

        // Contacts (customers and suppliers)
        Route::get('contacts', [ContactController::class, 'index'])->name('contacts.index');
        Route::post('contacts', [ContactController::class, 'store'])->name('contacts.store');
        Route::get('contacts/{contact}', [ContactController::class, 'show'])->whereUuid('contact')->name('contacts.show');
        Route::put('contacts/{contact}', [ContactController::class, 'update'])->whereUuid('contact')->name('contacts.update');
        Route::post('contacts/{contact}/deactivate', [ContactController::class, 'deactivate'])->whereUuid('contact')->name('contacts.deactivate');

        // Tax codes with their dated rates, and tax groups
        Route::get('tax-codes', [TaxCodeController::class, 'index'])->name('tax-codes.index');
        Route::post('tax-codes', [TaxCodeController::class, 'store'])->name('tax-codes.store');
        Route::put('tax-codes/{taxCode}', [TaxCodeController::class, 'update'])->whereUuid('taxCode')->name('tax-codes.update');
        Route::post('tax-codes/{taxCode}/rates', [TaxCodeController::class, 'addRate'])->whereUuid('taxCode')->name('tax-codes.rates.store');
        Route::post('tax-codes/{taxCode}/deactivate', [TaxCodeController::class, 'deactivate'])->whereUuid('taxCode')->name('tax-codes.deactivate');
        Route::get('tax-groups', [TaxGroupController::class, 'index'])->name('tax-groups.index');
        Route::post('tax-groups', [TaxGroupController::class, 'store'])->name('tax-groups.store');
        Route::put('tax-groups/{taxGroup}', [TaxGroupController::class, 'update'])->whereUuid('taxGroup')->name('tax-groups.update');
        Route::post('tax-groups/{taxGroup}/deactivate', [TaxGroupController::class, 'deactivate'])->whereUuid('taxGroup')->name('tax-groups.deactivate');

        // Exchange rates and unrealised-FX revaluation runs
        Route::get('fx-rates', [ExchangeRateController::class, 'index'])->name('fx-rates.index');
        Route::post('fx-rates', [ExchangeRateController::class, 'store'])->name('fx-rates.store');
        Route::post('fx-rates/fetch', [ExchangeRateController::class, 'fetch'])->name('fx-rates.fetch');
        Route::get('fx-revaluations', [FxRevaluationController::class, 'index'])->name('fx-revaluations.index');
        Route::get('fx-revaluations/preview', [FxRevaluationController::class, 'preview'])->name('fx-revaluations.preview');
        Route::post('fx-revaluations', [FxRevaluationController::class, 'run'])->name('fx-revaluations.run');

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

        // Attachments: presigned upload → complete → ClamAV scan → signed download (13 §17)
        Route::get('attachments', [AttachmentController::class, 'index'])->name('attachments.index');
        Route::post('attachments/uploads', [AttachmentController::class, 'store'])->name('attachments.store');
        Route::get('attachments/{attachment}', [AttachmentController::class, 'show'])->whereUuid('attachment')->name('attachments.show');
        Route::post('attachments/{attachment}/complete', [AttachmentController::class, 'complete'])->whereUuid('attachment')->name('attachments.complete');
        Route::get('attachments/{attachment}/download', [AttachmentController::class, 'download'])->whereUuid('attachment')->name('attachments.download');
        Route::delete('attachments/{attachment}', [AttachmentController::class, 'destroy'])->whereUuid('attachment')->name('attachments.destroy');

        // Reports (13 §13): statements and ledger detail from the reporting connection, the drill behind every cell, exports.
        Route::get('reports/trial-balance', [ReportController::class, 'trialBalance'])->name('reports.trial-balance');
        Route::get('reports/profit-and-loss', [ReportController::class, 'profitAndLoss'])->name('reports.profit-and-loss');
        Route::get('reports/balance-sheet', [ReportController::class, 'balanceSheet'])->name('reports.balance-sheet');
        Route::get('reports/cash-flow', [ReportController::class, 'cashFlow'])->name('reports.cash-flow');
        Route::get('reports/general-ledger', [ReportController::class, 'generalLedger'])->name('reports.general-ledger');
        Route::get('reports/ar-aging', [ReportController::class, 'arAging'])->name('reports.ar-aging');
        Route::get('reports/ap-aging', [ReportController::class, 'apAging'])->name('reports.ap-aging');
        Route::get('reports/customer-statement', [ReportController::class, 'customerStatement'])->name('reports.customer-statement');
        Route::get('reports/supplier-statement', [ReportController::class, 'supplierStatement'])->name('reports.supplier-statement');
        Route::get('reports/tax-return', [ReportController::class, 'taxReturn'])->name('reports.tax-return');
        Route::get('reports/drill', [ReportController::class, 'drill'])->name('reports.drill');
        Route::get('reports/exports/{exportId}', [ReportExportController::class, 'show'])->whereUuid('exportId')->name('reports.exports.show');
        Route::get('reports/{report}/export', [ReportExportController::class, 'export'])->whereIn('report', ReportExport::REPORTS)->middleware('throttle:report-exports')->name('reports.export');

        // Items: defaults for document lines
        Route::get('items', [ItemController::class, 'index'])->name('items.index');
        Route::post('items', [ItemController::class, 'store'])->name('items.store');
        Route::get('items/{item}', [ItemController::class, 'show'])->whereUuid('item')->name('items.show');
        Route::put('items/{item}', [ItemController::class, 'update'])->whereUuid('item')->name('items.update');
        Route::post('items/{item}/deactivate', [ItemController::class, 'deactivate'])->whereUuid('item')->name('items.deactivate');

        // Invoices and credit notes; bills and debit notes: same document lifecycle as journals (13 §16)
        foreach (['invoices' => [InvoiceController::class, 'invoice'], 'bills' => [BillController::class, 'bill']] as $path => [$controller, $param]) {
            Route::get($path, [$controller, 'index'])->name("{$path}.index");
            Route::post($path, [$controller, 'store'])->name("{$path}.store");
            Route::get("{$path}/{{$param}}", [$controller, 'show'])->whereUuid($param)->name("{$path}.show");
            Route::put("{$path}/{{$param}}", [$controller, 'update'])->whereUuid($param)->name("{$path}.update");
            Route::post("{$path}/{{$param}}/posting-preview", [$controller, 'preview'])->whereUuid($param)->name("{$path}.preview");
            Route::post("{$path}/{{$param}}/submit", [$controller, 'submit'])->whereUuid($param)->name("{$path}.submit");
            Route::post("{$path}/{{$param}}/approve", [$controller, 'approve'])->whereUuid($param)->name("{$path}.approve");
            Route::post("{$path}/{{$param}}/return", [$controller, 'return'])->whereUuid($param)->name("{$path}.return");
            Route::post("{$path}/{{$param}}/void", [$controller, 'void'])->whereUuid($param)->name("{$path}.void");
            Route::post("{$path}/{{$param}}/reverse", [$controller, 'reverse'])->whereUuid($param)->name("{$path}.reverse");
        }

        foreach (['invoices' => 'invoice', 'bills' => 'bill'] as $path => $param) {
            Route::post("{$path}/{{$param}}/allocate", [$path === 'invoices' ? InvoiceController::class : BillController::class, 'allocate'])->whereUuid($param)->name("{$path}.allocate");
        }

        // Settlements (receipts, payments, refunds), credit applications, payment runs, WHT certificates (13 §16)
        Route::get('settlements', [SettlementController::class, 'index'])->name('settlements.index');
        Route::post('settlements', [SettlementController::class, 'store'])->name('settlements.store');
        Route::get('settlements/{settlement}', [SettlementController::class, 'show'])->whereUuid('settlement')->name('settlements.show');
        Route::put('settlements/{settlement}', [SettlementController::class, 'update'])->whereUuid('settlement')->name('settlements.update');
        foreach (['posting-preview' => 'preview', 'submit' => 'submit', 'approve' => 'approve', 'return' => 'return', 'void' => 'void', 'reverse' => 'reverse', 'allocate' => 'allocate'] as $verb => $method) {
            Route::post("settlements/{settlement}/{$verb}", [SettlementController::class, $method])->whereUuid('settlement')->name("settlements.{$method}");
        }
        Route::post('credit-applications/{creditApplication}/undo', [CreditApplicationController::class, 'undo'])->whereUuid('creditApplication')->name('credit-applications.undo');
        Route::get('payment-runs', [PaymentRunController::class, 'index'])->name('payment-runs.index');
        Route::post('payment-runs', [PaymentRunController::class, 'store'])->name('payment-runs.store');
        Route::get('payment-runs/{paymentRun}', [PaymentRunController::class, 'show'])->whereUuid('paymentRun')->name('payment-runs.show');
        Route::put('payment-runs/{paymentRun}', [PaymentRunController::class, 'update'])->whereUuid('paymentRun')->name('payment-runs.update');
        Route::get('payment-runs/{paymentRun}/export', [PaymentRunController::class, 'export'])->whereUuid('paymentRun')->name('payment-runs.export');
        foreach (['posting-preview' => 'preview', 'submit' => 'submit', 'approve' => 'approve', 'return' => 'return', 'void' => 'void'] as $verb => $method) {
            Route::post("payment-runs/{paymentRun}/{$verb}", [PaymentRunController::class, $method])->whereUuid('paymentRun')->name("payment-runs.{$method}");
        }
        Route::get('wht-certificates', [WhtCertificateController::class, 'index'])->name('wht-certificates.index');
        Route::get('wht-certificates/{whtCertificate}', [WhtCertificateController::class, 'show'])->whereUuid('whtCertificate')->name('wht-certificates.show');

        // Recurring invoices, bills and journals: schedules copy a posted template into drafts on each due date (doc 14 E2)
        foreach (['recurring-invoices' => [RecurringInvoiceController::class, 'recurringInvoice'], 'recurring-journals' => [RecurringJournalController::class, 'recurringJournal']] as $path => [$controller, $param]) {
            Route::get($path, [$controller, 'index'])->name("{$path}.index");
            Route::post($path, [$controller, 'store'])->name("{$path}.store");
            Route::get("{$path}/{{$param}}", [$controller, 'show'])->whereUuid($param)->name("{$path}.show");
            Route::put("{$path}/{{$param}}", [$controller, 'update'])->whereUuid($param)->name("{$path}.update");
            Route::post("{$path}/{{$param}}/pause", [$controller, 'pause'])->whereUuid($param)->name("{$path}.pause");
            Route::post("{$path}/{{$param}}/resume", [$controller, 'resume'])->whereUuid($param)->name("{$path}.resume");
        }
        Route::get('recurring-runs', [RecurringRunController::class, 'index'])->name('recurring-runs.index');
        Route::post('recurring-runs', [RecurringRunController::class, 'run'])->name('recurring-runs.run');

        // Data imports (plan 2.18): upload → mapping → preview → queued apply; people only
        Route::get('imports', [ImportController::class, 'index'])->name('imports.index');
        Route::get('imports/kinds', [ImportController::class, 'kinds'])->name('imports.kinds');
        Route::post('imports', [ImportController::class, 'store'])->name('imports.store');
        Route::get('imports/{import}', [ImportController::class, 'show'])->whereUuid('import')->name('imports.show');
        Route::put('imports/{import}/mapping', [ImportController::class, 'mapping'])->whereUuid('import')->name('imports.mapping');
        Route::post('imports/{import}/preview', [ImportController::class, 'preview'])->whereUuid('import')->name('imports.preview');
        Route::post('imports/{import}/apply', [ImportController::class, 'apply'])->whereUuid('import')->name('imports.apply');
        Route::get('imports/{import}/rows', [ImportController::class, 'rows'])->whereUuid('import')->name('imports.rows');
        Route::post('imports/{import}/purge', [ImportController::class, 'purge'])->whereUuid('import')->name('imports.purge');

        // Audit log of the company, and the chain check (audit.view / audit.verify)
        Route::get('audit-events', [AuditController::class, 'index'])->name('audit-events.index');
        Route::post('audit-events/verify', [AuditController::class, 'verify'])->middleware('throttle:6,1')->name('audit-events.verify');

        // Banking: accounts, statement import, lines, matching, bank transactions, rules, reconciliations (13 §16)
        Route::get('bank-accounts', [BankAccountController::class, 'index'])->name('bank-accounts.index');
        Route::post('bank-accounts', [BankAccountController::class, 'store'])->name('bank-accounts.store');
        Route::get('bank-accounts/{bankAccount}', [BankAccountController::class, 'show'])->whereUuid('bankAccount')->name('bank-accounts.show');
        Route::put('bank-accounts/{bankAccount}', [BankAccountController::class, 'update'])->whereUuid('bankAccount')->name('bank-accounts.update');
        Route::get('bank-accounts/{bankAccount}/statements', [BankAccountController::class, 'statements'])->whereUuid('bankAccount')->name('bank-accounts.statements');
        Route::post('bank-accounts/{bankAccount}/statements', [BankAccountController::class, 'import'])->whereUuid('bankAccount')->name('bank-accounts.import');
        Route::get('bank-accounts/{bankAccount}/lines', [BankAccountController::class, 'lines'])->whereUuid('bankAccount')->name('bank-accounts.lines');
        Route::get('bank-accounts/{bankAccount}/reconciliations', [BankReconciliationController::class, 'index'])->whereUuid('bankAccount')->name('bank-accounts.reconciliations');
        Route::get('bank-statement-lines/{statementLine}', [BankAccountController::class, 'line'])->whereUuid('statementLine')->name('bank-statement-lines.show');
        Route::get('bank-statement-lines/{statementLine}/suggestions', [BankMatchingController::class, 'suggestions'])->whereUuid('statementLine')->name('bank-statement-lines.suggestions');
        Route::post('bank-statement-lines/{statementLine}/transactions', [BankMatchingController::class, 'transaction'])->whereUuid('statementLine')->name('bank-statement-lines.transactions');
        Route::post('bank-statement-lines/{statementLine}/apply-rule', [BankMatchingController::class, 'applyRule'])->whereUuid('statementLine')->name('bank-statement-lines.apply-rule');
        Route::post('bank-matches', [BankMatchingController::class, 'match'])->name('bank-matches.store');
        Route::delete('bank-matches/{bankMatch}', [BankMatchingController::class, 'unmatch'])->whereUuid('bankMatch')->name('bank-matches.destroy');
        Route::get('bank-transactions', [BankMatchingController::class, 'transactions'])->name('bank-transactions.index');
        Route::get('bank-transactions/{bankTransaction}', [BankMatchingController::class, 'showTransaction'])->whereUuid('bankTransaction')->name('bank-transactions.show');
        Route::get('bank-rules', [BankRuleController::class, 'index'])->name('bank-rules.index');
        Route::post('bank-rules', [BankRuleController::class, 'store'])->name('bank-rules.store');
        Route::put('bank-rules/order', [BankRuleController::class, 'order'])->name('bank-rules.order');
        Route::put('bank-rules/{bankRule}', [BankRuleController::class, 'update'])->whereUuid('bankRule')->name('bank-rules.update');
        Route::delete('bank-rules/{bankRule}', [BankRuleController::class, 'destroy'])->whereUuid('bankRule')->name('bank-rules.destroy');
        Route::post('bank-reconciliations', [BankReconciliationController::class, 'store'])->name('bank-reconciliations.store');
        Route::get('bank-reconciliations/{bankReconciliation}', [BankReconciliationController::class, 'show'])->whereUuid('bankReconciliation')->name('bank-reconciliations.show');
        Route::post('bank-reconciliations/{bankReconciliation}/finish', [BankReconciliationController::class, 'finish'])->whereUuid('bankReconciliation')->name('bank-reconciliations.finish');
        Route::post('bank-reconciliations/{bankReconciliation}/reopen', [BankReconciliationController::class, 'reopen'])->whereUuid('bankReconciliation')->name('bank-reconciliations.reopen');

        // Approvals: the inbox, and the workflows that feed it (settings.manage)
        Route::get('approvals', [ApprovalInboxController::class, 'index'])->name('approvals.index');
        Route::post('approvals/bulk-approve', [ApprovalInboxController::class, 'bulkApprove'])->name('approvals.bulk-approve');
        Route::get('approval-workflows', [ApprovalWorkflowController::class, 'index'])->name('approval-workflows.index');
        Route::post('approval-workflows', [ApprovalWorkflowController::class, 'store'])->name('approval-workflows.store');
        Route::put('approval-workflows/{workflow}', [ApprovalWorkflowController::class, 'update'])->whereUuid('workflow')->name('approval-workflows.update');
        Route::post('approval-workflows/{workflow}/deactivate', [ApprovalWorkflowController::class, 'deactivate'])->whereUuid('workflow')->name('approval-workflows.deactivate');
    });
