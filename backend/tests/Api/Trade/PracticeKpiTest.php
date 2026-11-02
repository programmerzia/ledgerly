<?php

declare(strict_types=1);

use App\Actions\Organisation\AssignCompanyRole;
use App\Actions\Organisation\Inputs\CompanyRoleInput;
use App\Jobs\Practice\RefreshTenantKpis;
use App\Support\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;

/*
 * Practice overview figures (13 §7, plan 2.19) through the real API: AR and AP come from the aging reports in each
 * company's own base currency, the snapshot says when it was computed, and a company the member holds no role in is
 * not listed.
 */

beforeEach(function (): void {
    $this->setUpTrade();
    $this->refresh = function (): void {
        app(TenantContext::class)->clear();
        RefreshTenantKpis::dispatchSync($this->f->tenantId);
    };
    $this->overview = fn ($as): array => $this->asPerson($as)->getJson('/api/v1/practice/overview')->assertOk()->json('data.practices');
});

it('shows open AR, AP, pending approvals and period states per company, with as_of, in the company base currency', function (): void {
    $before = ($this->overview)($this->owner);
    expect($before[0]['companies'])->toBe([]); // nothing flagged or computed yet

    $this->sale(10000, '2026-03-15');   // 11,000 with VAT
    $this->postedDoc('bills', $this->t->body($this->t->supplier, [[5000, '1']], '2026-03-10'));
    ($this->refresh)();

    $practices = ($this->overview)($this->owner);
    expect($practices)->toHaveCount(1);
    $c = $practices[0]['companies'][0];
    expect($c['id'])->toBe($this->f->companyId)
        ->and($c['base_currency'])->toBe('USD')
        ->and($c['open_ar'])->toBe(['amount' => 11000, 'currency' => 'USD'])
        ->and($c['open_ap']['currency'])->toBe('USD')->and($c['open_ap']['amount'])->toBeGreaterThan(0)
        ->and($c['pending_approvals'])->toBe(0)
        ->and($c['last_closed_period'])->toBeNull()
        ->and($c['period_states'])->toBe(['open' => 13, 'soft_closed' => 0, 'closed' => 0, 'locked' => 0])
        ->and($c['as_of'])->toMatch('/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/');

    // The figures equal the aging reports'.
    $aging = $this->asPerson($this->owner)->getJson($this->api('reports/ap-aging'))->assertOk()->json('data.totals.open');
    expect($c['open_ap'])->toBe($aging);
});

it('keeps each company in its own currency and lists a company only to members who can open it', function (): void {
    $b = $this->secondCompany();
    $this->inTenant(fn () => DB::table('companies')->where('id', $b->id)->update(['base_currency' => 'EUR']));
    $clerk = $this->person('Clara Clerk', ['Accountant']);                       // a role in company A only
    $both = $this->person('Bea Both', ['Accountant']);
    $this->inTenant(fn () => app(AssignCompanyRole::class)->handle($this->f->actor, new CompanyRoleInput($both->id, $b->id, 'Accountant')));
    DB::connection('pgsql_owner')->table('tenant_users')->where('user_id', $this->owner->id)->update(['role' => 'admin']);
    ($this->refresh)();

    $admin = ($this->overview)($this->owner)[0]['companies'];
    expect(array_column($admin, 'base_currency'))->toContain('USD', 'EUR')->and($admin)->toHaveCount(2);
    $byId = array_column($admin, null, 'id');
    expect($byId[$this->f->companyId]['open_ar']['currency'])->toBe('USD')->and($byId[$b->id]['open_ar']['currency'])->toBe('EUR');

    expect(array_column(($this->overview)($clerk)[0]['companies'], 'id'))->toBe([$this->f->companyId])
        ->and(array_column(($this->overview)($both)[0]['companies'], 'id'))->toEqualCanonicalizing([$this->f->companyId, $b->id]);
});

it('refuses an API token with 403', function (): void {
    $this->asToken($this->newToken(['journals:read']))->getJson('/api/v1/practice/overview')->assertForbidden()->assertJson(['code' => 'forbidden']);
});
