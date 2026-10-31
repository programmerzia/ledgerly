<?php

declare(strict_types=1);

use App\Actions\Organisation\AssignCompanyRole;
use App\Actions\Organisation\Inputs\CompanyRoleInput;
use App\Actions\Organisation\RevokeCompanyRole;
use App\Actions\Organisation\SeedCompanyRoles;
use App\Contracts\PermissionChecker;
use App\Domain\Organisation\PermissionMatrix;
use App\Domain\Shared\DomainRuleViolation;
use App\Support\Actor;
use App\Support\ActorType;
use App\Support\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Spatie\Permission\PermissionRegistrar;
use Tests\Support\LedgerFixture;

/** Adds an active member to the fixture's tenant. */
function addMember(LedgerFixture $f, string $name = 'member', string $orgRole = 'member'): Actor
{
    $id = (string) Str::uuid7();
    DB::table('users')->insert(['id' => $id, 'name' => $name, 'email' => "{$name}@{$f->tenantId}.test", 'password' => 'x']);
    DB::table('tenant_users')->insert(['tenant_id' => $f->tenantId, 'user_id' => $id, 'role' => $orgRole]);

    return new Actor(ActorType::User, $id, $f->tenantId, $f->companyId, requestId: 'test');
}

function seedRoles(LedgerFixture $f, ?string $companyId = null): void
{
    app(SeedCompanyRoles::class)->handle($f->actor, $companyId ?? $f->companyId);
}

function assign(LedgerFixture $f, Actor $member, string $role, ?Actor $by = null, ?string $companyId = null): void
{
    app(AssignCompanyRole::class)->handle($by ?? $f->actor, new CompanyRoleInput($member->id, $companyId ?? $f->companyId, $role));
}

function secondCompany(LedgerFixture $f): string
{
    $id = (string) Str::uuid7();
    DB::table('companies')->insert(['id' => $id, 'tenant_id' => $f->tenantId, 'name' => 'Second', 'slug' => 'second', 'country' => 'US', 'base_currency' => 'USD']);

    return $id;
}

it('seeds permissions and the seven roles with exactly the matrix, idempotently', function () {
    $f = LedgerFixture::create();
    seedRoles($f);
    $snapshot = fn () => [
        DB::table('permissions')->count(), DB::table('roles')->count(), DB::table('role_has_permissions')->count(),
        DB::table('audit_events')->where('action', 'company_roles.seeded')->count(),
    ];
    $first = $snapshot();
    seedRoles($f);

    expect($snapshot())->toBe($first)
        ->and($first[0])->toBe(count(PermissionMatrix::permissions()))
        ->and($first[1])->toBe(7)->and($first[3])->toBe(1);

    foreach (PermissionMatrix::ROLES as $role) {
        $names = DB::table('role_has_permissions as rp')->join('roles as r', 'r.id', '=', 'rp.role_id')
            ->join('permissions as p', 'p.id', '=', 'rp.permission_id')->where('r.name', $role)->pluck('p.name')->all();
        expect($names)->toEqualCanonicalizing(PermissionMatrix::forRole($role));
    }
});

it('repairs a role that drifted from the matrix', function () {
    $f = LedgerFixture::create();
    seedRoles($f);
    DB::table('role_has_permissions')->whereIn('role_id', DB::table('roles')->where('name', 'Viewer')->select('id'))->limit(2)->delete();
    seedRoles($f);

    expect(DB::table('role_has_permissions')->whereIn('role_id', DB::table('roles')->where('name', 'Viewer')->select('id'))->count())
        ->toBe(count(PermissionMatrix::forRole('Viewer')));
});

it('assigns and revokes a company role, audited, and both are idempotent', function () {
    $f = LedgerFixture::create();
    seedRoles($f);
    $member = addMember($f);
    $checker = app(PermissionChecker::class);

    expect($checker->allows($member, 'invoices.create', $f->companyId))->toBeFalse();
    assign($f, $member, 'Accountant');
    assign($f, $member, 'Accountant');
    expect($checker->allows($member, 'invoices.create', $f->companyId))->toBeTrue()
        ->and(DB::table('model_has_roles')->count())->toBe(1)
        ->and(DB::table('audit_events')->where('action', 'company_role.assigned')->count())->toBe(1);

    app(RevokeCompanyRole::class)->handle($f->actor, new CompanyRoleInput($member->id, $f->companyId, 'Accountant'));
    app(RevokeCompanyRole::class)->handle($f->actor, new CompanyRoleInput($member->id, $f->companyId, 'Accountant'));
    expect($checker->allows($member, 'invoices.create', $f->companyId))->toBeFalse()
        ->and(DB::table('model_has_roles')->count())->toBe(0)
        ->and(DB::table('audit_events')->where('action', 'company_role.revoked')->count())->toBe(1);
});

it('rejects assignment by a plain member, an API client, or to a non-member or unknown role', function () {
    $f = LedgerFixture::create();
    seedRoles($f);
    $member = addMember($f, 'plain');
    $other = addMember($f, 'other');
    $admin = addMember($f, 'boss', 'admin');

    expect(fn () => assign($f, $other, 'Viewer', by: $member))->toThrow(DomainRuleViolation::class)
        ->and(fn () => assign($f, $other, 'Viewer', by: new Actor(ActorType::ApiClient, $admin->id, $f->tenantId)))->toThrow(DomainRuleViolation::class);

    assign($f, $other, 'Viewer', by: $admin);
    expect(DB::table('model_has_roles')->count())->toBe(1);

    $stranger = LedgerFixture::create(slug: 'beta');
    app(TenantContext::class)->set($f->tenantId);
    $strangerActor = new Actor(ActorType::User, $stranger->userId, $f->tenantId);
    expect(fn () => assign($f, $strangerActor, 'Viewer'))->toThrow(DomainRuleViolation::class, 'not an active member')
        ->and(fn () => assign($f, $member, 'Wizard'))->toThrow(DomainRuleViolation::class, 'no role named');
});

it('answers permission checks per company: a role in company 1 gives nothing in company 2', function () {
    $f = LedgerFixture::create();
    $c2 = secondCompany($f);
    seedRoles($f);
    seedRoles($f, $c2);
    $member = addMember($f);
    assign($f, $member, 'Approver');
    $checker = app(PermissionChecker::class);

    expect($checker->allows($member, 'journals.approve', $f->companyId))->toBeTrue()
        ->and($checker->allows($member, 'journals.approve', $c2))->toBeFalse()
        ->and($checker->allows($member, 'journals.create', $f->companyId))->toBeFalse();

    assign($f, $member, 'Viewer', companyId: $c2);
    expect($checker->allows($member, 'journals.view', $c2))->toBeTrue()
        ->and($checker->allows($member, 'journals.approve', $c2))->toBeFalse();
});

it('denies API clients, system actors, unknown permissions and unknown users', function () {
    $f = LedgerFixture::create();
    seedRoles($f);
    $member = addMember($f);
    assign($f, $member, 'Owner');
    $checker = app(PermissionChecker::class);

    expect($checker->allows(new Actor(ActorType::ApiClient, $member->id, $f->tenantId), 'journals.view', $f->companyId))->toBeFalse()
        ->and($checker->allows(Actor::system($f->tenantId), 'journals.view', $f->companyId))->toBeFalse()
        ->and($checker->allows($member, 'nope.nothing', $f->companyId))->toBeFalse()
        ->and($checker->allows(new Actor(ActorType::User, (string) Str::uuid7(), $f->tenantId), 'journals.view', $f->companyId))->toBeFalse();
});

it('sees a revoked role immediately (registry cache is refreshed on change)', function () {
    $f = LedgerFixture::create();
    seedRoles($f);
    $member = addMember($f);
    assign($f, $member, 'Viewer');
    $checker = app(PermissionChecker::class);
    expect($checker->allows($member, 'journals.view', $f->companyId))->toBeTrue();

    DB::table('role_has_permissions')->delete();
    app(PermissionRegistrar::class)->forgetCachedPermissions();
    expect($checker->allows($member, 'journals.view', $f->companyId))->toBeFalse();
});
