<?php

declare(strict_types=1);

namespace App\Providers;

use App\Contracts\Clock;
use App\Contracts\CompanyAccess;
use App\Contracts\IdGenerator;
use App\Contracts\PermissionChecker;
use App\Models\Platform\PersonalAccessToken;
use App\Services\DenyAllPermissions;
use App\Services\Ledger\SequenceAllocator;
use App\Services\SystemClock;
use App\Services\Tenancy\OrgRoleCompanyAccess;
use App\Services\UuidV7Generator;
use App\Support\Tenancy\CompanyContext;
use App\Support\Tenancy\TenantContext;
use App\Support\UnitOfWork\AuditWriter;
use App\Support\UnitOfWork\OutboxWriter;
use App\Support\UnitOfWork\UnitOfWork;
use Illuminate\Console\Events\CommandStarting;
use Illuminate\Database\DatabaseManager;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Events\ConnectionEstablished;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\ServiceProvider;
use Laravel\Cashier\Cashier;
use Laravel\Fortify\Fortify;
use Laravel\Sanctum\Sanctum;

class AppServiceProvider extends ServiceProvider
{
    /** Commands that change schema run as the owner role (13 §6); the app role cannot. */
    private const array OWNER_COMMANDS = ['migrate', 'migrate:fresh', 'migrate:refresh', 'migrate:reset', 'migrate:rollback', 'migrate:status', 'migrate:install', 'db:seed', 'db:wipe', 'schema:dump'];

    public function register(): void
    {
        // Auth routes are registered under /api/v1/auth in plan step 1.4, billing webhooks in 4.6.
        // Until then the packages must not expose their default routes.
        Fortify::ignoreRoutes();
        Cashier::ignoreRoutes();

        $this->app->singleton(Clock::class, SystemClock::class);
        $this->app->singleton(IdGenerator::class, UuidV7Generator::class);
        $this->app->singleton(PermissionChecker::class, DenyAllPermissions::class);
        $this->app->singleton(CompanyAccess::class, OrgRoleCompanyAccess::class);
        $this->app->scoped(CompanyContext::class);

        $this->app->scoped(TenantContext::class, function ($app) {
            /** @var list<string> $connections */
            $connections = $app['config']->get('tenancy.connections');

            return new TenantContext($app->make(DatabaseManager::class), $connections);
        });

        $this->app->scoped(UnitOfWork::class, fn ($app) => new UnitOfWork(
            $app->make(DatabaseManager::class),
            $app->make(TenantContext::class),
            $app->make(SequenceAllocator::class),
            $app->make(AuditWriter::class),
            $app->make(OutboxWriter::class),
            (bool) $app['config']->get('tenancy.strict_lock_order'),
        ));
    }

    public function boot(): void
    {
        Model::shouldBeStrict(! $this->app->isProduction());
        Sanctum::usePersonalAccessTokenModel(PersonalAccessToken::class);

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
