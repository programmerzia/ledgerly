<?php

declare(strict_types=1);

use App\Models\Platform\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

beforeEach(function (): void {
    $this->setUpTrade();
    $this->admin = $this->person('Ada Admin', [], org: 'admin');
    /** @return array<string, string> role name → id, from the API */
    $this->roleIds = fn (): array => collect($this->getJson($this->api('roles'))->assertOk()->json('data'))->pluck('id', 'name')->all();
});

it('lists the organisation\'s people with their roles per company', function (): void {
    $this->asPerson($this->admin);
    $members = collect($this->getJson('/api/v1/members')->assertOk()->json('data'))->keyBy('email');
    $ann = $members['ann.accountant1@test.example'];
    expect($ann['role'])->toBe('member')->and((array) $ann['company_roles'][$this->f->companyId])->toBe(['Accountant'])
        ->and($members['maker@acme.test']['role'])->toBe('owner')->and($members['ada.admin5@test.example']['role'])->toBe('admin');

    $this->asPerson($this->accountant)->getJson('/api/v1/members')->assertForbidden();
    $this->asToken($this->newToken(['contacts:read']))->getJson('/api/v1/members')->assertForbidden();
});

it('lists a company\'s roles with permissions and head count', function (): void {
    $roles = collect($this->asPerson($this->admin)->getJson($this->api('roles'))->assertOk()->json('data'))->keyBy('name');
    expect($roles->keys()->all())->toContain('Owner', 'Accountant', 'Approver', 'Viewer', 'Auditor')
        ->and($roles['Accountant']['members'])->toBe(1)->and($roles['Accountant']['permissions'])->toContain('invoices.create')
        ->and($roles['Viewer']['permissions'])->not->toContain('invoices.create');
});

it('assigns and revokes company roles, audited, and repeating either changes nothing', function (): void {
    $this->asPerson($this->admin);
    $ids = ($this->roleIds)();
    $viewer = $this->person('Vic Viewer', ['Viewer']);
    $path = fn (string $role) => $this->api("members/{$viewer->id}/roles/{$ids[$role]}");

    $this->putJson($path('Approver'), [], $this->key())->assertOk()->assertJsonPath('data.company_roles.'.$this->f->companyId, ['Approver', 'Viewer']);
    $this->putJson($path('Approver'), [], $this->key())->assertOk();
    expect($this->inTenant(fn () => DB::table('audit_events')->where('action', 'company_role.assigned')->where('after->user_id', $viewer->id)->count()))->toBe(2); // Viewer at setup, Approver now; the repeat adds nothing

    // The new right works at once.
    $this->asPerson($viewer, signing: true)->getJson($this->api('approvals'))->assertOk();

    $this->asPerson($this->admin)->deleteJson($path('Viewer'), [], $this->key())->assertOk()->assertJsonPath('data.company_roles.'.$this->f->companyId, ['Approver']);
    $this->deleteJson($path('Viewer'), [], $this->key())->assertOk();
    expect($this->inTenant(fn () => DB::table('audit_events')->where('action', 'company_role.revoked')->count()))->toBe(1);
});

it('refuses roles for people outside the organisation and roles that do not exist, and people who are not admins', function (): void {
    $this->asPerson($this->admin);
    $ids = ($this->roleIds)();
    $outsider = (string) Str::uuid7();
    DB::table('users')->insert(['id' => $outsider, 'name' => 'Out Sider', 'email' => 'out@test.example', 'password' => 'x']);

    $this->putJson($this->api("members/{$outsider}/roles/{$ids['Viewer']}"), [], $this->key())->assertStatus(422)->assertJson(['code' => 'user_not_in_tenant']);
    $this->putJson($this->api("members/{$this->accountant->id}/roles/".Str::uuid7()), [], $this->key())->assertNotFound();

    // Another company's role id is no role of this company.
    $beta = $this->secondCompany();
    $betaRole = $this->inTenant(fn () => DB::table('roles')->where('company_id', $beta->id)->where('name', 'Viewer')->value('id'));
    $this->putJson($this->api("members/{$this->accountant->id}/roles/{$betaRole}"), [], $this->key())->assertNotFound();

    $this->asPerson($this->accountant)->putJson($this->api("members/{$this->accountant->id}/roles/{$ids['Owner']}"), [], $this->key())->assertForbidden();
    $this->asPerson(User::query()->findOrFail($this->f->userId))->putJson($this->api("members/{$this->accountant->id}/roles/{$ids['Approver']}"), [], $this->key())->assertOk();
    $this->asToken($this->newToken(['contacts:read']))->putJson($this->api("members/{$this->accountant->id}/roles/{$ids['Owner']}"), [], $this->key())->assertForbidden();
});
