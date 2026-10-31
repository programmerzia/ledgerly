<?php

declare(strict_types=1);

use App\Actions\Organisation\AssignCompanyRole;
use App\Actions\Organisation\Inputs\CompanyRoleInput;
use App\Actions\Organisation\SeedCompanyRoles;
use App\Contracts\PermissionChecker;
use App\Services\Tenancy\TenantAwarePermissionRegistrar;
use App\Support\Actor;
use App\Support\ActorType;
use App\Support\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Spatie\Permission\PermissionRegistrar;
use Tests\Support\LedgerFixture;

/** @return array{LedgerFixture, Actor} tenant with seeded roles and a member holding Owner */
function tenantWithOwnerRole(string $slug): array
{
    $f = LedgerFixture::create(slug: $slug);
    app(SeedCompanyRoles::class)->handle($f->actor, $f->companyId);
    $id = (string) Str::uuid7();
    DB::table('users')->insert(['id' => $id, 'name' => $slug, 'email' => "m@{$slug}.test", 'password' => 'x']);
    DB::table('tenant_users')->insert(['tenant_id' => $f->tenantId, 'user_id' => $id, 'role' => 'member']);
    $member = new Actor(ActorType::User, $id, $f->tenantId, $f->companyId);
    app(AssignCompanyRole::class)->handle($f->actor, new CompanyRoleInput($id, $f->companyId, 'Owner'));

    return [$f, $member];
}

it('hides the other tenant\'s permission rows and refuses cross-tenant writes', function () {
    [$a] = tenantWithOwnerRole('alpha');
    [$b] = tenantWithOwnerRole('beta');
    $context = app(TenantContext::class);

    foreach (['permissions', 'roles', 'role_has_permissions', 'model_has_roles'] as $table) {
        expect(DB::table($table)->where('tenant_id', $a->tenantId)->count())->toBe(0, $table)
            ->and(DB::table($table)->count())->toBeGreaterThan(0);
    }

    expect(fn () => DB::table('roles')->insert([
        'id' => (string) Str::uuid7(), 'tenant_id' => $a->tenantId, 'company_id' => $a->companyId, 'name' => 'x', 'guard_name' => 'web',
    ]))->toThrow(QueryException::class, 'row-level security');

    $context->run($a->tenantId, fn () => expect(DB::table('roles')->count())->toBe(7));
    $context->clear();
    expect(DB::table('permissions')->count())->toBe(0);
});

it('never lets tenant A\'s roles answer a check in tenant B within one process (registry cache isolation)', function () {
    expect(app(PermissionRegistrar::class))->toBeInstanceOf(TenantAwarePermissionRegistrar::class);
    [$a, $memberA] = tenantWithOwnerRole('alpha');
    [$b, $memberB] = tenantWithOwnerRole('beta');
    // Give B's member a role in B that lacks journals.create; A's member is Owner (has it).
    $checker = app(PermissionChecker::class);
    $context = app(TenantContext::class);

    // Warm the registry in A, then ask B with the same process / same registrar.
    $context->set($a->tenantId);
    expect($checker->allows($memberA, 'journals.create', $a->companyId))->toBeTrue();

    $context->set($b->tenantId);
    expect($checker->allows($memberA, 'journals.create', $a->companyId))->toBeFalse() // A's member, A's company, seen from B
        ->and($checker->allows($memberB, 'journals.create', $b->companyId))->toBeTrue()
        ->and($checker->allows($memberB, 'journals.create', $a->companyId))->toBeFalse();

    // Poison attempt: B's registry loses all role links; A must still answer from its own data.
    DB::table('role_has_permissions')->delete();
    app(PermissionRegistrar::class)->forgetCachedPermissions();
    expect($checker->allows($memberB, 'journals.create', $b->companyId))->toBeFalse();

    $context->set($a->tenantId);
    expect($checker->allows($memberA, 'journals.create', $a->companyId))->toBeTrue();
});
