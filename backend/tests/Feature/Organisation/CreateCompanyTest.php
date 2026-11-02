<?php

declare(strict_types=1);

use App\Actions\Organisation\CreateCompany;
use App\Actions\Organisation\Inputs\CreateCompanyInput;
use App\Domain\Shared\DomainRuleViolation;
use App\Support\Actor;
use App\Support\ActorType;
use Illuminate\Support\Facades\DB;
use Tests\Support\LedgerFixture;

function newCompany(array $over = []): CreateCompanyInput
{
    return new CreateCompanyInput(...array_merge([
        'name' => 'Globex Ltd', 'country' => 'GB', 'baseCurrency' => 'GBP', 'fiscalYearStartMonth' => 1,
        'legalName' => 'Globex Limited', 'taxId' => 'GB123',
    ], $over));
}

it('creates the company with settings, roles, the Owner role and the current fiscal year', function (): void {
    $f = LedgerFixture::create();

    $company = app(CreateCompany::class)->handle($f->actor, newCompany());

    expect($company->slug)->toBe('globex-ltd')->and($company->base_currency)->toBe('GBP')->and($company->status)->toBe('active');
    expect(DB::table('company_settings')->where('company_id', $company->id)->count())->toBe(1);
    expect(DB::table('roles')->where('company_id', $company->id)->count())->toBe(7);

    $owner = DB::table('model_has_roles')->where('company_id', $company->id)->where('model_id', $f->userId)->first();
    expect($owner)->not->toBeNull();
    expect(DB::table('roles')->where('id', $owner->role_id)->value('name'))->toBe('Owner');

    $year = DB::table('fiscal_years')->where('company_id', $company->id)->first();
    expect($year->name)->toBe('FY2026')->and($year->starts_on)->toBe('2026-01-01')->and($year->ends_on)->toBe('2026-12-31');
    expect(DB::table('fiscal_periods')->where('company_id', $company->id)->where('kind', 'regular')->count())->toBe(12);
    expect(DB::table('fiscal_periods')->where('company_id', $company->id)->where('kind', 'adjustment')->count())->toBe(1);
    expect(DB::table('audit_events')->where('action', 'company.created')->where('subject_id', $company->id)->count())->toBe(1);
});

it('starts the fiscal year in the previous calendar year when the start month is still ahead', function (): void {
    $f = LedgerFixture::create(); // clock is 2026-03-15

    $july = app(CreateCompany::class)->handle($f->actor, newCompany(['name' => 'July Co', 'fiscalYearStartMonth' => 7]));
    $year = DB::table('fiscal_years')->where('company_id', $july->id)->first();
    expect($year->name)->toBe('FY2025/26')->and($year->starts_on)->toBe('2025-07-01')->and($year->ends_on)->toBe('2026-06-30');

    $feb = app(CreateCompany::class)->handle($f->actor, newCompany(['name' => 'Feb Co', 'fiscalYearStartMonth' => 2]));
    $year = DB::table('fiscal_years')->where('company_id', $feb->id)->first();
    expect($year->name)->toBe('FY2026/27')->and($year->starts_on)->toBe('2026-02-01');
});

it('forbids plain members', function (): void {
    $f = LedgerFixture::create();
    $id = (string) Str::uuid7();
    DB::table('users')->insert(['id' => $id, 'name' => 'm', 'email' => 'm@acme.test', 'password' => 'x']);
    DB::table('tenant_users')->insert(['tenant_id' => $f->tenantId, 'user_id' => $id, 'role' => 'member']);
    $member = new Actor(ActorType::User, $id, $f->tenantId, requestId: 'test');

    expect(fn () => app(CreateCompany::class)->handle($member, newCompany()))
        ->toThrow(fn (DomainRuleViolation $e) => $e->errorCode === 'forbidden');
    expect(DB::table('companies')->count())->toBe(1);
});

it('rejects an unknown currency and rolls back', function (): void {
    $f = LedgerFixture::create();

    expect(fn () => app(CreateCompany::class)->handle($f->actor, newCompany(['baseCurrency' => 'ZZZ'])))
        ->toThrow(fn (DomainRuleViolation $e) => $e->errorCode === 'currency_not_found');
    expect(DB::table('companies')->count())->toBe(1);
});

it('makes slugs unique within the tenant', function (): void {
    $f = LedgerFixture::create();

    $a = app(CreateCompany::class)->handle($f->actor, newCompany(['name' => 'Same Name']));
    $b = app(CreateCompany::class)->handle($f->actor, newCompany(['name' => 'Same Name']));
    $c = app(CreateCompany::class)->handle($f->actor, newCompany(['name' => 'Same Name']));

    expect([$a->slug, $b->slug, $c->slug])->toBe(['same-name', 'same-name-2', 'same-name-3']);
});

it('never uses a slug that would shadow a route of the SPA', function (): void {
    $f = LedgerFixture::create();
    $company = app(CreateCompany::class)->handle(new Actor(ActorType::User, $f->userId, $f->tenantId), new CreateCompanyInput(
        name: 'New Company', country: 'GB', baseCurrency: 'GBP', fiscalYearStartMonth: 1,
    ));

    expect($company->slug)->toBe('new-company-co');
});
