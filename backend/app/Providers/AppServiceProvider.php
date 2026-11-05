<?php

declare(strict_types=1);

namespace App\Providers;

use App\Actions\Signing\SetSigningPin;
use App\Actions\Signing\VerifySigningPin;
use App\Contracts\AttachmentStore;
use App\Contracts\Clock;
use App\Contracts\CompanyAccess;
use App\Contracts\ExchangeRateProvider;
use App\Contracts\HostResolver;
use App\Contracts\IdGenerator;
use App\Contracts\PermissionChecker;
use App\Contracts\RoleChecker;
use App\Contracts\VirusScanner;
use App\Http\Support\CompanyBindings;
use App\Models\Audit\AuditEvent;
use App\Models\Banking\BankAccount;
use App\Models\Banking\BankMatch;
use App\Models\Banking\BankReconciliation;
use App\Models\Banking\BankRule;
use App\Models\Banking\BankStatementLine;
use App\Models\Banking\BankTransaction;
use App\Models\Files\Attachment;
use App\Models\Fiscal\FiscalPeriod;
use App\Models\Fiscal\FiscalYear;
use App\Models\Fiscal\PeriodReopenRequest;
use App\Models\FixedAssets\AssetCategory;
use App\Models\FixedAssets\AssetTaxClass;
use App\Models\FixedAssets\AssetTransaction;
use App\Models\FixedAssets\DepreciationRun;
use App\Models\FixedAssets\FixedAsset;
use App\Models\Fx\ExchangeRate;
use App\Models\Fx\FxRevaluation;
use App\Models\Imports\Import;
use App\Models\Ledger\Account;
use App\Models\Ledger\Dimension;
use App\Models\Ledger\Journal;
use App\Models\Organisation\ApiClient;
use App\Models\Organisation\Company;
use App\Models\Organisation\Invitation;
use App\Models\Platform\PersonalAccessToken;
use App\Models\Platform\TenantUser;
use App\Models\Procurement\GoodsReceipt;
use App\Models\Procurement\PurchaseOrder;
use App\Models\Procurement\PurchaseOrderRevision;
use App\Models\Procurement\PurchaseRequisition;
use App\Models\Recurring\RecurringInvoice;
use App\Models\Recurring\RecurringJournal;
use App\Models\Tax\TaxCode;
use App\Models\Tax\TaxGroup;
use App\Models\Trade\Contact;
use App\Models\Trade\CreditApplication;
use App\Models\Trade\Invoice;
use App\Models\Trade\Item;
use App\Models\Trade\PaymentRun;
use App\Models\Trade\Settlement;
use App\Models\Trade\WhtCertificate;
use App\Models\Webhooks\WebhookEndpoint;
use App\Models\Workflow\ApprovalRequest;
use App\Models\Workflow\ApprovalWorkflow;
use App\Policies\Audit\AuditPolicy;
use App\Policies\Banking\BankingPolicy;
use App\Policies\Files\AttachmentPolicy;
use App\Policies\Fiscal\PeriodPolicy;
use App\Policies\FixedAssets\AssetTransactionPolicy;
use App\Policies\FixedAssets\DepreciationRunPolicy;
use App\Policies\FixedAssets\FixedAssetPolicy;
use App\Policies\Fx\FxPolicy;
use App\Policies\Imports\ImportPolicy;
use App\Policies\Ledger\AccountPolicy;
use App\Policies\Ledger\DimensionPolicy;
use App\Policies\Ledger\JournalPolicy;
use App\Policies\Organisation\ApiClientPolicy;
use App\Policies\Organisation\CompanyPolicy;
use App\Policies\Organisation\InvitationPolicy;
use App\Policies\Organisation\MemberPolicy;
use App\Policies\Practice\PracticePolicy;
use App\Policies\Procurement\GoodsReceiptPolicy;
use App\Policies\Procurement\PurchaseOrderPolicy;
use App\Policies\Procurement\PurchaseOrderRevisionPolicy;
use App\Policies\Procurement\PurchaseRequisitionPolicy;
use App\Policies\Recurring\RecurringSchedulePolicy;
use App\Policies\Reports\ReportPolicy;
use App\Policies\SigningPolicy;
use App\Policies\Tax\TaxCodePolicy;
use App\Policies\Tax\TaxGroupPolicy;
use App\Policies\Trade\ContactPolicy;
use App\Policies\Trade\CreditApplicationPolicy;
use App\Policies\Trade\InvoicePolicy;
use App\Policies\Trade\ItemPolicy;
use App\Policies\Trade\PaymentRunPolicy;
use App\Policies\Trade\SettlementPolicy;
use App\Policies\Trade\WhtCertificatePolicy;
use App\Policies\Webhooks\WebhookEndpointPolicy;
use App\Policies\Workflow\ApprovalRequestPolicy;
use App\Policies\Workflow\ApprovalWorkflowPolicy;
use App\Queries\Practice\PracticeOverview;
use App\Services\Files\ClamdScanner;
use App\Services\Files\LocalAttachmentStore;
use App\Services\Fx\EcbRateProvider;
use App\Services\Ledger\SequenceAllocator;
use App\Services\SystemClock;
use App\Services\Tenancy\SpatieCompanyAccess;
use App\Services\Tenancy\SpatiePermissionChecker;
use App\Services\Tenancy\SpatieRoleChecker;
use App\Services\Tenancy\TenantAwarePermissionRegistrar;
use App\Services\UuidV7Generator;
use App\Support\Idempotency\IdempotencyStore;
use App\Support\Reports\LedgerVersion;
use App\Support\Reports\Report;
use App\Support\Tenancy\CompanyContext;
use App\Support\Tenancy\TenantContext;
use App\Support\UnitOfWork\AuditWriter;
use App\Support\UnitOfWork\OutboxWriter;
use App\Support\UnitOfWork\UnitOfWork;
use App\Support\Webhooks\DnsHostResolver;
use App\Support\Webhooks\SsrfGuard;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Console\Events\CommandStarting;
use Illuminate\Contracts\Hashing\Hasher;
use Illuminate\Database\DatabaseManager;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Events\ConnectionEstablished;
use Illuminate\Hashing\HashManager;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;
use Laravel\Cashier\Cashier;
use Laravel\Sanctum\Sanctum;
use Spatie\Permission\PermissionRegistrar;

class AppServiceProvider extends ServiceProvider
{
    /** Commands that change schema run as the owner role (13 §6); the app role cannot. */
    private const array OWNER_COMMANDS = ['migrate', 'migrate:fresh', 'migrate:refresh', 'migrate:reset', 'migrate:rollback', 'migrate:status', 'migrate:install', 'db:seed', 'db:wipe', 'schema:dump'];

    public function register(): void
    {
        // Billing webhooks are registered in plan step 4.6; until then Cashier exposes no routes.
        Cashier::ignoreRoutes();

        $this->app->singleton(Clock::class, SystemClock::class);
        $this->app->singleton(IdGenerator::class, UuidV7Generator::class);
        $this->app->singleton(PermissionChecker::class, SpatiePermissionChecker::class);
        $this->app->singleton(RoleChecker::class, SpatieRoleChecker::class);
        // extend() so the swap holds whatever the provider order is relative to spatie's own singleton.
        $this->app->extend(PermissionRegistrar::class, fn ($registrar, $app) => new TenantAwarePermissionRegistrar($app->make('cache')));
        $this->app->singleton(CompanyAccess::class, SpatieCompanyAccess::class);
        $this->app->singleton(ExchangeRateProvider::class, EcbRateProvider::class);
        $this->app->singleton(HostResolver::class, DnsHostResolver::class);
        $this->app->singleton(SsrfGuard::class, fn ($app) => new SsrfGuard($app->make(HostResolver::class), (bool) config('webhooks.allow_http')));
        // Attachments (13 §17). Local-disk store until an S3 store exists (needs league/flysystem-aws-s3-v3, which 04 §2 does not pin).
        $this->app->singleton(AttachmentStore::class, LocalAttachmentStore::class);
        $this->app->singleton(VirusScanner::class, fn () => ClamdScanner::tcp(
            (string) config('attachments.clamav.host'), (int) config('attachments.clamav.port'),
            (int) config('attachments.clamav.timeout'), (int) config('attachments.clamav.chunk_bytes'),
        ));
        $this->app->scoped(CompanyContext::class);

        $this->app->scoped(TenantContext::class, function ($app) {
            /** @var list<string> $connections */
            $connections = $app['config']->get('tenancy.connections');

            return new TenantContext($app->make(DatabaseManager::class), $connections);
        });

        // The signing PIN is hashed with argon2id (ADR-0004), whatever the password hasher is.
        $this->app->when([SetSigningPin::class, VerifySigningPin::class])
            ->needs(Hasher::class)
            ->give(fn ($app) => $app->make(HashManager::class)->driver('argon2id'));

        $this->app->scoped(UnitOfWork::class, fn ($app) => new UnitOfWork(
            $app->make(DatabaseManager::class),
            $app->make(TenantContext::class),
            $app->make(SequenceAllocator::class),
            $app->make(AuditWriter::class),
            $app->make(OutboxWriter::class),
            $app->make(IdempotencyStore::class),
            (bool) $app['config']->get('tenancy.strict_lock_order'),
            ledgerVersion: $app->make(LedgerVersion::class),
        ));
    }

    public function boot(): void
    {
        Model::shouldBeStrict(! $this->app->isProduction());
        Sanctum::usePersonalAccessTokenModel(PersonalAccessToken::class);

        // Explicit map, no guessing (13 §7). Policies take any principal and decide for people (permissions)
        // and API clients (token abilities) themselves; whatever approves, reverses or closes asks for a person.
        Gate::policy(Company::class, CompanyPolicy::class);
        Gate::policy(PracticeOverview::class, PracticePolicy::class);
        Gate::policy(Invitation::class, InvitationPolicy::class);
        Gate::policy(ApiClient::class, ApiClientPolicy::class);
        Gate::policy(TenantUser::class, MemberPolicy::class);
        Gate::policy(Journal::class, JournalPolicy::class);
        Gate::policy(Account::class, AccountPolicy::class);
        Gate::policy(Dimension::class, DimensionPolicy::class);
        Gate::policy(ExchangeRate::class, FxPolicy::class);
        Gate::policy(FxRevaluation::class, FxPolicy::class);
        Gate::policy(Contact::class, ContactPolicy::class);
        Gate::policy(Invoice::class, InvoicePolicy::class);
        Gate::policy(PurchaseRequisition::class, PurchaseRequisitionPolicy::class);
        Gate::policy(PurchaseOrder::class, PurchaseOrderPolicy::class);
        Gate::policy(PurchaseOrderRevision::class, PurchaseOrderRevisionPolicy::class);
        Gate::policy(GoodsReceipt::class, GoodsReceiptPolicy::class);
        Gate::policy(Item::class, ItemPolicy::class);
        Gate::policy(Settlement::class, SettlementPolicy::class);
        Gate::policy(PaymentRun::class, PaymentRunPolicy::class);
        Gate::policy(WhtCertificate::class, WhtCertificatePolicy::class);
        Gate::policy(CreditApplication::class, CreditApplicationPolicy::class);
        Gate::policy(Attachment::class, AttachmentPolicy::class);
        foreach ([AssetCategory::class, FixedAsset::class, AssetTaxClass::class] as $assetModel) {
            Gate::policy($assetModel, FixedAssetPolicy::class);
        }
        Gate::policy(DepreciationRun::class, DepreciationRunPolicy::class);
        Gate::policy(AssetTransaction::class, AssetTransactionPolicy::class);
        foreach ([BankAccount::class, BankStatementLine::class, BankMatch::class, BankRule::class, BankTransaction::class, BankReconciliation::class] as $bankModel) {
            Gate::policy($bankModel, BankingPolicy::class);
        }
        Gate::policy(TaxCode::class, TaxCodePolicy::class);
        Gate::policy(TaxGroup::class, TaxGroupPolicy::class);
        Gate::policy(WebhookEndpoint::class, WebhookEndpointPolicy::class);
        Gate::policy(AuditEvent::class, AuditPolicy::class);
        Gate::policy(Import::class, ImportPolicy::class);
        Gate::policy(RecurringInvoice::class, RecurringSchedulePolicy::class);
        Gate::policy(RecurringJournal::class, RecurringSchedulePolicy::class);
        foreach ([FiscalYear::class, FiscalPeriod::class, PeriodReopenRequest::class] as $model) {
            Gate::policy($model, PeriodPolicy::class);
        }
        Gate::policy(ApprovalWorkflow::class, ApprovalWorkflowPolicy::class);
        Gate::policy(ApprovalRequest::class, ApprovalRequestPolicy::class);
        Gate::policy(Report::class, ReportPolicy::class);
        CompanyBindings::register();

        // 13 §16: API client 600/min, SPA user 300/min, each counted per principal.
        RateLimiter::for('company-api', function (Request $request): Limit {
            $principal = call_user_func($request->getUserResolver());

            return $principal instanceof ApiClient
                ? Limit::perMinute(600)->by('client:'.$principal->id)
                : Limit::perMinute(300)->by('user:'.(is_object($principal) && method_exists($principal, 'getAuthIdentifier') ? (string) $principal->getAuthIdentifier() : (string) $request->ip()));
        });
        // 13 §16: 10 report exports an hour per company, whoever asks.
        RateLimiter::for('report-exports', function (Request $request): Limit {
            $company = $request->route('company');

            return Limit::perHour((int) config('reports.exports_per_hour'))->by('report-exports:'.($company instanceof Company ? $company->id : (string) $company));
        });
        Gate::define('sign', [SigningPolicy::class, 'sign']);

        Event::listen(ConnectionEstablished::class, function (ConnectionEstablished $event): void {
            if ($this->app->resolved(TenantContext::class)) {
                $this->app->make(TenantContext::class)->reapply($event->connection);
            }
        });

        Event::listen(CommandStarting::class, function (CommandStarting $event): void {
            if (in_array($event->command, self::OWNER_COMMANDS, true) && ! $event->input->hasParameterOption('--database')) {
                config(['database.default' => 'pgsql_owner']);
            }
        });
    }
}
