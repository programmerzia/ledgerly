<?php

declare(strict_types=1);

namespace Tests\Support;

use App\Actions\Fiscal\CreateFiscalYear;
use App\Actions\Fiscal\Inputs\CreateFiscalYearInput;
use App\Contracts\IdGenerator;
use App\Models\Fiscal\FiscalPeriod;
use App\Support\Actor;
use App\Support\ActorType;
use App\Support\Tenancy\TenantContext;
use DateTimeImmutable;
use Illuminate\Support\Facades\DB;

/**
 * A tenant with one company, a small chart of accounts and fiscal year FY2026 (Jan–Dec + adjustment).
 * Leaves the tenant context set.
 */
final class LedgerFixture
{
    /** @var array<string, string> account code → id */
    public array $accounts = [];

    public string $userId;

    public string $tenantId;

    public string $companyId;

    public Actor $actor;

    private function __construct() {}

    public static function create(string $baseCurrency = 'USD', string $slug = 'acme'): self
    {
        $f = new self;
        $ids = app(IdGenerator::class);
        $f->tenantId = $ids->next();
        $f->userId = $ids->next();
        $f->companyId = $ids->next();

        DB::table('tenants')->insert(['id' => $f->tenantId, 'name' => ucfirst($slug), 'slug' => $slug, 'lifecycle' => 'active']);
        DB::table('users')->insert(['id' => $f->userId, 'name' => 'Maker '.$slug, 'email' => "maker@{$slug}.test", 'password' => 'x']);
        DB::table('tenant_users')->insert(['tenant_id' => $f->tenantId, 'user_id' => $f->userId, 'role' => 'owner']);

        app(TenantContext::class)->set($f->tenantId);
        $f->actor = new Actor(ActorType::User, $f->userId, $f->tenantId, $f->companyId, requestId: 'test');

        DB::table('companies')->insert([
            'id' => $f->companyId, 'tenant_id' => $f->tenantId, 'name' => 'Acme '.$slug, 'slug' => $slug,
            'country' => 'US', 'base_currency' => $baseCurrency,
        ]);

        foreach ([
            ['1000', 'Cash', 'asset', 'debit', 'cash', 'base_only', null],
            ['1100', 'Accounts receivable', 'asset', 'debit', 'ar', 'any', null],
            ['1200', 'Bank EUR', 'asset', 'debit', 'bank', 'fixed', 'EUR'],
            ['1300', 'Prepayments', 'asset', 'debit', 'none', 'any', null],
            ['2000', 'Accounts payable', 'liability', 'credit', 'ap', 'any', null],
            ['3000', 'Retained earnings', 'equity', 'credit', 'retained_earnings', 'base_only', null],
            ['4000', 'Sales', 'income', 'credit', 'none', 'base_only', null],
            ['5000', 'Expenses', 'expense', 'debit', 'none', 'base_only', null],
        ] as [$code, $name, $type, $normal, $control, $policy, $fixed]) {
            $f->accounts[$code] = $ids->next();
            DB::table('accounts')->insert([
                'id' => $f->accounts[$code], 'tenant_id' => $f->tenantId, 'company_id' => $f->companyId,
                'code' => $code, 'name' => $name, 'account_type' => $type, 'normal_balance' => $normal,
                'control_type' => $control, 'currency_policy' => $policy, 'fixed_currency' => $fixed,
            ]);
        }

        app(CreateFiscalYear::class)->handle(Actor::system($f->tenantId, $f->companyId), new CreateFiscalYearInput($f->companyId, new DateTimeImmutable('2026-01-01'), 'FY2026'));

        return $f;
    }

    public function account(string $code): string
    {
        return $this->accounts[$code];
    }

    public function period(string $date): FiscalPeriod
    {
        return FiscalPeriod::query()->where('company_id', $this->companyId)->where('kind', 'regular')
            ->where('starts_on', '<=', $date)->where('ends_on', '>=', $date)->firstOrFail();
    }

    public function adjustmentPeriod(): FiscalPeriod
    {
        return FiscalPeriod::query()->where('company_id', $this->companyId)->where('kind', 'adjustment')->firstOrFail();
    }

    public function setPeriodStatus(string $date, string $status): void
    {
        DB::table('fiscal_periods')->where('id', $this->period($date)->id)->update(['status' => $status]);
    }

    /** The owner with a verified signing PIN. */
    public function signedActor(): Actor
    {
        return new Actor(ActorType::User, $this->userId, $this->tenantId, $this->companyId, hasSigningGrant: true, requestId: 'test');
    }

    public function actorAs(ActorType $type): Actor
    {
        return new Actor($type, $this->userId, $this->tenantId, $this->companyId);
    }
}
