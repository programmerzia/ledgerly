<?php

declare(strict_types=1);

use App\Actions\Organisation\AssignCompanyRole;
use App\Actions\Organisation\CreateCompanyRole;
use App\Actions\Organisation\DeleteCompanyRole;
use App\Actions\Organisation\Inputs\CompanyRoleInput;
use App\Actions\Organisation\ResetCompanyRole;
use App\Actions\Organisation\RevokeCompanyRole;
use App\Actions\Organisation\SeedCompanyRoles;
use App\Actions\Organisation\UpdateCompanyRole;
use App\Domain\Organisation\PermissionMatrix;
use App\Domain\Shared\DomainRuleViolation;
use App\Models\Organisation\Role;
use App\Support\Actor;
use App\Support\ActorType;
use Illuminate\Support\Facades\DB;
use Tests\Support\LedgerFixture;

/** A fixture whose acting org owner also holds the Owner company role, so they may hand out any right. */
function roleFixture(): LedgerFixture
{
    $f = LedgerFixture::create();
    app(SeedCompanyRoles::class)->handle($f->actor, $f->companyId);
    app(AssignCompanyRole::class)->handle($f->actor, new CompanyRoleInput($f->userId, $f->companyId, 'Owner'));

    return $f;
}

function roleId(LedgerFixture $f, string $name): string
{
    return (string) Role::query()->where('company_id', $f->companyId)->where('name', $name)->value('id');
}

/** @return list<string> */
function rolePermissions(LedgerFixture $f, string $name): array
{
    return DB::table('role_has_permissions as rp')->join('permissions as p', 'p.id', '=', 'rp.permission_id')
        ->where('rp.role_id', roleId($f, $name))->orderBy('p.name')->pluck('p.name')->all();
}

function expectedDefault(string $role): array
{
    $names = PermissionMatrix::forRole($role);
    sort($names);

    return $names;
}

it('marks the seven seeded roles as system roles and unedited', function () {
    $f = roleFixture();

    $rows = DB::table('roles')->where('company_id', $f->companyId)->get();
    expect($rows)->toHaveCount(7)->and($rows->every(fn ($r) => $r->is_system && ! $r->permissions_edited))->toBeTrue();
});

it('leaves an edited role alone when seeding runs again, and repairs an unedited one', function () {
    $f = roleFixture();
    $role = app(UpdateCompanyRole::class)->handle($f->actor, $f->companyId, roleId($f, 'Accountant'), null, ['invoices.view', 'invoices.create']);
    expect($role->permissions_edited)->toBeTrue();

    // An unedited role drifts by hand; seeding repairs it, and does not touch the edited one.
    DB::table('role_has_permissions')->where('role_id', roleId($f, 'Viewer'))->limit(3)->delete();
    app(SeedCompanyRoles::class)->handle($f->actor, $f->companyId);

    expect(rolePermissions($f, 'Accountant'))->toBe(['invoices.create', 'invoices.view'])
        ->and(rolePermissions($f, 'Viewer'))->toBe(expectedDefault('Viewer'))
        ->and(rolePermissions($f, 'Owner'))->toBe(expectedDefault('Owner'));
});

it('does not give a custom role anything when seeding runs again', function () {
    $f = roleFixture();
    $custom = app(CreateCompanyRole::class)->handle($f->actor, $f->companyId, 'Clerk', ['invoices.view']);

    app(SeedCompanyRoles::class)->handle($f->actor, $f->companyId);

    expect(rolePermissions($f, 'Clerk'))->toBe(['invoices.view'])->and($custom->is_system)->toBeFalse();
});

it('gives a permission missing from the matrix to unedited seeded roles only (the backfill path)', function () {
    $f = roleFixture();
    $GLOBALS['roleTestTenant'] = $f->tenantId;
    $custom = app(CreateCompanyRole::class)->handle($f->actor, $f->companyId, 'Budget reader', ['reports.view']);
    app(UpdateCompanyRole::class)->handle($f->actor, $f->companyId, roleId($f, 'Accountant'), null, ['invoices.view']); // edited

    // Pretend budgets.manage / budgets.view are new to the matrix: no role holds them yet.
    $ids = DB::table('permissions')->whereIn('name', ['budgets.view', 'budgets.manage'])->pluck('id')->all();
    DB::table('role_has_permissions')->whereIn('permission_id', $ids)->delete();
    app(UpdateCompanyRole::class)->handle($f->actor, $f->companyId, $custom->id, null, ['reports.view']);

    foreach ([
        fn () => app(SeedCompanyRoles::class)->handle($f->actor, $f->companyId),
        function () {
            $migration = require base_path('database/migrations/2026_11_05_000602_backfill_budget_permissions.php');
            $migration->up();
            DB::statement("SELECT set_config('app.tenant_id', ?, false)", [$GLOBALS['roleTestTenant']]); // the migration clears the tenant context
        },
    ] as $run) {
        DB::table('role_has_permissions')->whereIn('permission_id', $ids)->delete();
        $run();

        expect(rolePermissions($f, 'Finance Manager'))->toContain('budgets.manage', 'budgets.view')
            ->and(rolePermissions($f, 'Viewer'))->toContain('budgets.view')
            ->and(rolePermissions($f, 'Owner'))->toContain('budgets.manage')
            ->and(rolePermissions($f, 'Accountant'))->toBe(['invoices.view'])
            ->and(rolePermissions($f, 'Budget reader'))->toBe(['reports.view']);
    }
});

it('makes a role unedited again when its permissions are put back, and on reset', function () {
    $f = roleFixture();
    $id = roleId($f, 'Viewer');
    $edited = app(UpdateCompanyRole::class)->handle($f->actor, $f->companyId, $id, null, [...expectedDefault('Viewer'), 'invoices.create']);
    expect($edited->permissions_edited)->toBeTrue();

    $reset = app(ResetCompanyRole::class)->handle($f->actor, $f->companyId, $id);
    expect($reset->permissions_edited)->toBeFalse()->and(rolePermissions($f, 'Viewer'))->toBe(expectedDefault('Viewer'));

    app(UpdateCompanyRole::class)->handle($f->actor, $f->companyId, $id, null, ['invoices.view']);
    $back = app(UpdateCompanyRole::class)->handle($f->actor, $f->companyId, $id, null, expectedDefault('Viewer'));
    expect($back->permissions_edited)->toBeFalse();
});

it('locks Owner, fixes the names of standard roles and refuses to delete them', function () {
    $f = roleFixture();
    $violation = fn (Closure $do) => (function () use ($do): string {
        try {
            $do();
        } catch (DomainRuleViolation $e) {
            return $e->errorCode;
        }

        return 'none';
    })();

    expect($violation(fn () => app(UpdateCompanyRole::class)->handle($f->actor, $f->companyId, roleId($f, 'Owner'), null, ['invoices.view'])))->toBe('role_locked')
        ->and($violation(fn () => app(ResetCompanyRole::class)->handle($f->actor, $f->companyId, roleId($f, 'Owner'))))->toBe('role_locked')
        ->and($violation(fn () => app(UpdateCompanyRole::class)->handle($f->actor, $f->companyId, roleId($f, 'Viewer'), 'Looker', expectedDefault('Viewer'))))->toBe('role_name_fixed')
        ->and($violation(fn () => app(DeleteCompanyRole::class)->handle($f->actor, $f->companyId, roleId($f, 'Viewer'))))->toBe('role_is_system')
        ->and($violation(fn () => app(CreateCompanyRole::class)->handle($f->actor, $f->companyId, 'viewer', [])))->toBe('role_name_taken')
        ->and($violation(fn () => app(CreateCompanyRole::class)->handle($f->actor, $f->companyId, 'Clerk', ['invoices.fly'])))->toBe('permission_unknown');
});

it('refuses to give rights the person does not hold, but lets them give rights they hold', function () {
    $f = roleFixture();
    $other = Role::query()->where('company_id', $f->companyId)->where('name', 'Viewer')->firstOrFail();
    // A second org admin who holds only Accountant rights in this company.
    $id = (string) Str::uuid7();
    DB::table('users')->insert(['id' => $id, 'name' => 'Ann', 'email' => "ann@{$f->tenantId}.test", 'password' => 'x']);
    DB::table('tenant_users')->insert(['tenant_id' => $f->tenantId, 'user_id' => $id, 'role' => 'admin']);
    app(AssignCompanyRole::class)->handle($f->actor, new CompanyRoleInput($id, $f->companyId, 'Accountant'));
    $ann = new Actor(ActorType::User, $id, $f->tenantId, $f->companyId, requestId: 'test');

    expect(fn () => app(CreateCompanyRole::class)->handle($ann, $f->companyId, 'Approving clerk', ['journals.view', 'journals.approve']))
        ->toThrow(DomainRuleViolation::class, 'journals.approve');
    expect(fn () => app(UpdateCompanyRole::class)->handle($ann, $f->companyId, $other->id, null, [...expectedDefault('Viewer'), 'periods.close']))
        ->toThrow(DomainRuleViolation::class, 'periods.close');

    $ok = app(CreateCompanyRole::class)->handle($ann, $f->companyId, 'Invoice clerk', ['invoices.view', 'invoices.create']);
    expect($ok->name)->toBe('Invoice clerk');

    // Taking rights away is not handing them out.
    app(UpdateCompanyRole::class)->handle($ann, $f->companyId, $ok->id, null, ['invoices.view']);
    expect(rolePermissions($f, 'Invoice clerk'))->toBe(['invoices.view']);
});

it('keeps the last Owner, and audits every change with before and after', function () {
    $f = roleFixture();
    expect(fn () => app(RevokeCompanyRole::class)->handle($f->actor, new CompanyRoleInput($f->userId, $f->companyId, 'Owner')))
        ->toThrow(DomainRuleViolation::class, 'last Owner');

    // With a second Owner the first can step down.
    $second = (string) Str::uuid7();
    DB::table('users')->insert(['id' => $second, 'name' => 'Bo', 'email' => "bo@{$f->tenantId}.test", 'password' => 'x']);
    DB::table('tenant_users')->insert(['tenant_id' => $f->tenantId, 'user_id' => $second, 'role' => 'member']);
    app(AssignCompanyRole::class)->handle($f->actor, new CompanyRoleInput($second, $f->companyId, 'Owner'));
    app(RevokeCompanyRole::class)->handle($f->actor, new CompanyRoleInput($f->userId, $f->companyId, 'Owner'));
    expect(DB::table('model_has_roles')->where('company_id', $f->companyId)->where('role_id', roleId($f, 'Owner'))->count())->toBe(1);
});

it('audits create, update, reset and delete with the before and after sets', function () {
    $f = roleFixture();
    $role = app(CreateCompanyRole::class)->handle($f->actor, $f->companyId, 'Clerk', ['invoices.view']);
    app(UpdateCompanyRole::class)->handle($f->actor, $f->companyId, $role->id, 'Senior clerk', ['invoices.view', 'invoices.create']);
    app(UpdateCompanyRole::class)->handle($f->actor, $f->companyId, roleId($f, 'Viewer'), null, ['invoices.view']);
    app(ResetCompanyRole::class)->handle($f->actor, $f->companyId, roleId($f, 'Viewer'));
    app(DeleteCompanyRole::class)->handle($f->actor, $f->companyId, $role->id);

    $events = DB::table('audit_events')->whereIn('action', ['company_role.created', 'company_role.updated', 'company_role.reset', 'company_role.deleted'])->orderBy('id')->get();
    $update = $events->firstWhere('action', 'company_role.updated');
    $before = json_decode((string) $update->before, true);
    $after = json_decode((string) $update->after, true);

    expect($events->pluck('action')->all())->toBe(['company_role.created', 'company_role.updated', 'company_role.updated', 'company_role.reset', 'company_role.deleted'])
        ->and($before['name'])->toBe('Clerk')->and($before['permissions'])->toBe(['invoices.view'])
        ->and($after['name'])->toBe('Senior clerk')->and($after['permissions'])->toEqualCanonicalizing(['invoices.view', 'invoices.create'])
        ->and(json_decode((string) $events->last()->before, true)['name'])->toBe('Senior clerk');
});

it('refuses to delete a role somebody holds', function () {
    $f = roleFixture();
    $role = app(CreateCompanyRole::class)->handle($f->actor, $f->companyId, 'Clerk', ['invoices.view']);
    app(AssignCompanyRole::class)->handle($f->actor, new CompanyRoleInput($f->userId, $f->companyId, 'Clerk'));

    expect(fn () => app(DeleteCompanyRole::class)->handle($f->actor, $f->companyId, $role->id))->toThrow(DomainRuleViolation::class, 'held by 1 person');

    app(RevokeCompanyRole::class)->handle($f->actor, new CompanyRoleInput($f->userId, $f->companyId, 'Clerk'));
    app(DeleteCompanyRole::class)->handle($f->actor, $f->companyId, $role->id);
    expect(Role::query()->whereKey($role->id)->exists())->toBeFalse();
});
