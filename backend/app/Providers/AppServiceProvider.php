<?php

declare(strict_types=1);

namespace App\Providers;

use App\Actions\Signing\SetSigningPin;
use App\Actions\Signing\VerifySigningPin;
use App\Contracts\Clock;
use App\Contracts\CompanyAccess;
use App\Contracts\ExchangeRateProvider;
use App\Contracts\IdGenerator;
use App\Contracts\PermissionChecker;
use App\Contracts\RoleChecker;
use App\Http\Support\CompanyBindings;
use App\Models\Fiscal\FiscalPeriod;
use App\Models\Fiscal\FiscalYear;
use App\Models\Fiscal\PeriodReopenRequest;
use App\Models\Fx\ExchangeRate;
use App\Models\Fx\FxRevaluation;
use App\Models\Ledger\Account;
use App\Models\Ledger\Dimension;
use App\Models\Ledger\Journal;
use App\Models\Organisation\ApiClient;
use App\Models\Organisation\Company;
use App\Models\Organisation\Invitation;
use App\Models\Platform\PersonalAccessToken;
use App\Models\Tax\TaxCode;
use App\Models\Tax\TaxGroup;
use App\Models\Trade\Contact;
use App\Models\Workflow\ApprovalRequest;
use App\Models\Workflow\ApprovalWorkflow;
use App\Policies\Fiscal\PeriodPolicy;
use App\Policies\Fx\FxPolicy;
use App\Policies\Ledger\AccountPolicy;
use App\Policies\Ledger\DimensionPolicy;
use App\Policies\Ledger\JournalPolicy;
use App\Policies\Organisation\CompanyPolicy;
use App\Policies\Organisation\InvitationPolicy;
use App\Policies\SigningPolicy;
use App\Policies\Tax\TaxCodePolicy;
use App\Policies\Tax\TaxGroupPolicy;
use App\Policies\Trade\ContactPolicy;
use App\Policies\Workflow\ApprovalRequestPolicy;
use App\Policies\Workflow\ApprovalWorkflowPolicy;
use App\Services\Fx\EcbRateProvider;
use App\Services\Ledger\SequenceAllocator;
use App\Services\SystemClock;
use App\Services\Tenancy\SpatieCompanyAccess;
use App\Services\Tenancy\SpatiePermissionChecker;
use App\Services\Tenancy\SpatieRoleChecker;
use App\Services\Tenancy\TenantAwarePermissionRegistrar;
use App\Services\UuidV7Generator;
use App\Support\Idempotency\IdempotencyStore;
use App\Support\Tenancy\CompanyContext;
use App\Support\Tenancy\TenantContext;
use App\Support\UnitOfWork\AuditWriter;
use App\Support\UnitOfWork\OutboxWriter;
use App\Support\UnitOfWork\UnitOfWork;
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
        ));
    }

    public function boot(): void
    {
        Model::shouldBeStrict(! $this->app->isProduction());
        Sanctum::usePersonalAccessTokenModel(PersonalAccessToken::class);

        // Explicit map, no guessing (13 §7). Policies take any principal and decide for people (permissions)
        // and API clients (token abilities) themselves; whatever approves, reverses or closes asks for a person.
        Gate::policy(Company::class, CompanyPolicy::class);
        Gate::policy(Invitation::class, InvitationPolicy::class);
        Gate::policy(Journal::class, JournalPolicy::class);
        Gate::policy(Account::class, AccountPolicy::class);
        Gate::policy(Dimension::class, DimensionPolicy::class);
        Gate::policy(ExchangeRate::class, FxPolicy::class);
        Gate::policy(FxRevaluation::class, FxPolicy::class);
        Gate::policy(Contact::class, ContactPolicy::class);
        Gate::policy(TaxCode::class, TaxCodePolicy::class);
        Gate::policy(TaxGroup::class, TaxGroupPolicy::class);
        foreach ([FiscalYear::class, FiscalPeriod::class, PeriodReopenRequest::class] as $model) {
            Gate::policy($model, PeriodPolicy::class);
        }
        Gate::policy(ApprovalWorkflow::class, ApprovalWorkflowPolicy::class);
        Gate::policy(ApprovalRequest::class, ApprovalRequestPolicy::class);
        CompanyBindings::register();

        // 13 §16: API client 600/min, SPA user 300/min, each counted per principal.
        RateLimiter::for('company-api', function (Request $request): Limit {
            $principal = call_user_func($request->getUserResolver());

            return $principal instanceof ApiClient
                ? Limit::perMinute(600)->by('client:'.$principal->id)
                : Limit::perMinute(300)->by('user:'.(is_object($principal) && method_exists($principal, 'getAuthIdentifier') ? (string) $principal->getAuthIdentifier() : (string) $request->ip()));
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
