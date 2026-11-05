<?php

declare(strict_types=1);

use App\Domain\Organisation\PermissionCatalogue;
use App\Domain\Organisation\PermissionMatrix;
use Illuminate\Support\Facades\DB;

beforeEach(function (): void {
    $this->setUpTrade();
    // An org admin who also holds Owner in this company (may hand out any right), and one who holds only Accountant rights.
    $this->boss = $this->person('Bea Boss', ['Owner'], org: 'admin');
    $this->junior = $this->person('Jo Junior', ['Accountant'], org: 'admin');
    /** @return array<string, array<string, mixed>> role name → role, from the API */
    $this->roles = fn (): array => collect($this->getJson($this->api('roles'))->assertOk()->json('data'))->keyBy('name')->all();
});

it('lists roles with their kind, and the permission grid rows match the matrix exactly', function (): void {
    $this->asPerson($this->boss);
    $roles = ($this->roles)();
    expect($roles['Owner'])->toMatchArray(['system' => true, 'locked' => true, 'edited' => false])
        ->and($roles['Viewer'])->toMatchArray(['system' => true, 'locked' => false, 'edited' => false]);

    $grid = collect($this->getJson($this->api('permissions'))->assertOk()->json('data'));
    $names = $grid->flatMap(fn ($m) => collect($m['permissions'])->pluck('name'))->all();
    expect($names)->toEqualCanonicalizing(PermissionMatrix::permissions())
        ->and($grid->every(fn ($m) => $m['label'] !== '' && collect($m['permissions'])->every(fn ($p) => $p['label'] !== '' && ! str_contains($p['label'], '.'))))->toBeTrue()
        ->and(PermissionCatalogue::label('journals.approve'))->toBe('Approve journals');

    $this->asPerson($this->accountant)->getJson($this->api('permissions'))->assertForbidden();
});

it('creates a custom role that the server then enforces', function (): void {
    $this->asPerson($this->boss);
    $role = $this->postJson($this->api('roles'), ['name' => 'Invoice clerk', 'permissions' => ['invoices.view', 'invoices.create', 'contacts.view']], $this->key())
        ->assertCreated()->assertJsonPath('data.system', false)->assertJsonPath('data.members', 0)->json('data');
    $clerk = $this->person('Cy Clerk', []);
    $this->putJson($this->api("members/{$clerk->id}/roles/{$role['id']}"), [], $this->key())->assertOk();

    // What the role lists works, and nothing else does.
    $this->asPerson($clerk);
    $this->getJson($this->api('invoices'))->assertOk();
    $this->postJson($this->api('invoices'), $this->t->body($this->t->customer, [[10000, '1', 'VAT10']]), $this->key())->assertCreated();
    $this->getJson($this->api('bills'))->assertForbidden();
    $this->getJson($this->api('journals'))->assertForbidden();
    $this->postJson($this->api('journals'), $this->journalBody(), $this->key())->assertForbidden();
    $this->getJson($this->api('menu'))->assertOk()->assertJsonPath('data.permissions', ['contacts.view', 'invoices.create', 'invoices.view']);

    // Editing the role changes what the holder can do at once.
    $this->asPerson($this->boss)->putJson($this->api("roles/{$role['id']}"), ['name' => 'Invoice clerk', 'permissions' => ['invoices.view']], $this->key())
        ->assertOk()->assertJsonPath('data.members', 1);
    $this->asPerson($clerk)->postJson($this->api('invoices'), $this->t->body($this->t->customer, [[10000, '1', 'VAT10']]), $this->key())->assertForbidden();
    $this->getJson($this->api('invoices'))->assertOk();
});

it('refuses names and permissions it cannot accept', function (): void {
    $this->asPerson($this->boss);
    $post = fn (array $body) => $this->postJson($this->api('roles'), $body, $this->key());
    $post(['name' => 'Odd', 'permissions' => ['invoices.view', 'invoices.teleport']])->assertStatus(422)->assertJson(['code' => 'permission_unknown']);
    $post(['name' => 'Owner', 'permissions' => []])->assertStatus(422)->assertJson(['code' => 'role_name_taken']);
    $post(['name' => '   ', 'permissions' => []])->assertStatus(422);
    $post(['name' => 'Fine'])->assertStatus(422)->assertJsonValidationErrors(['permissions']);
    $post(['name' => 'Fine', 'permissions' => []])->assertCreated();
    $post(['name' => 'fine', 'permissions' => []])->assertStatus(422)->assertJson(['code' => 'role_name_taken']);
});

it('never lets a person give rights above their own', function (): void {
    $this->asPerson($this->junior);
    $this->postJson($this->api('roles'), ['name' => 'Sneaky', 'permissions' => ['invoices.view', 'journals.approve']], $this->key())
        ->assertStatus(422)->assertJson(['code' => 'permission_above_own']);
    $ids = ($this->roles)();
    $this->putJson($this->api("roles/{$ids['Viewer']['id']}"), ['permissions' => [...$ids['Viewer']['permissions'], 'periods.close']], $this->key())
        ->assertStatus(422)->assertJson(['code' => 'permission_above_own']);
    $this->postJson($this->api('roles'), ['name' => 'Fair', 'permissions' => ['invoices.view', 'invoices.create']], $this->key())->assertCreated();
});

it('locks Owner, fixes standard names, resets edits, and deletes only unheld custom roles', function (): void {
    $this->asPerson($this->boss);
    $roles = ($this->roles)();

    $this->putJson($this->api("roles/{$roles['Owner']['id']}"), ['permissions' => ['invoices.view']], $this->key())->assertStatus(422)->assertJson(['code' => 'role_locked']);
    $this->postJson($this->api("roles/{$roles['Owner']['id']}/reset"), [], $this->key())->assertStatus(422)->assertJson(['code' => 'role_locked']);
    $this->deleteJson($this->api("roles/{$roles['Owner']['id']}"), [], $this->key())->assertStatus(422)->assertJson(['code' => 'role_is_system']);
    $this->putJson($this->api("roles/{$roles['Viewer']['id']}"), ['name' => 'Looker', 'permissions' => $roles['Viewer']['permissions']], $this->key())->assertStatus(422)->assertJson(['code' => 'role_name_fixed']);

    // Edit a standard role: flagged edited, enforced, then reset.
    $viewer = $this->person('Val Viewer', ['Viewer']);
    $this->putJson($this->api("roles/{$roles['Viewer']['id']}"), ['permissions' => [...$roles['Viewer']['permissions'], 'invoices.create']], $this->key())
        ->assertOk()->assertJsonPath('data.edited', true)->assertJsonPath('data.system', true);
    $this->asPerson($viewer)->postJson($this->api('invoices'), $this->t->body($this->t->customer, [[10000, '1', 'VAT10']]), $this->key())->assertCreated();
    $this->asPerson($this->boss)->postJson($this->api("roles/{$roles['Viewer']['id']}/reset"), [], $this->key())->assertOk()->assertJsonPath('data.edited', false);
    $this->asPerson($viewer)->postJson($this->api('invoices'), $this->t->body($this->t->customer, [[10000, '1', 'VAT10']]), $this->key())->assertForbidden();

    // Custom roles: delete only when nobody holds it.
    $this->asPerson($this->boss);
    $custom = $this->postJson($this->api('roles'), ['name' => 'Temp', 'permissions' => ['invoices.view']], $this->key())->json('data');
    $holder = $this->person('Hal Holder', []);
    $this->putJson($this->api("members/{$holder->id}/roles/{$custom['id']}"), [], $this->key())->assertOk();
    $this->deleteJson($this->api("roles/{$custom['id']}"), [], $this->key())->assertStatus(422)->assertJson(['code' => 'role_in_use']);
    $this->deleteJson($this->api("members/{$holder->id}/roles/{$custom['id']}"), [], $this->key())->assertOk();
    $this->deleteJson($this->api("roles/{$custom['id']}"), [], $this->key())->assertNoContent();
    $this->getJson($this->api('roles'))->assertJsonMissing(['name' => 'Temp']);
});

it('keeps the last Owner through the API', function (): void {
    $this->asPerson($this->boss);
    $owner = ($this->roles)()['Owner'];
    // Bea and Olga hold Owner; the original org owner holds it only through CreateCompany in real life, not in this fixture.
    $this->deleteJson($this->api("members/{$this->owner->id}/roles/{$owner['id']}"), [], $this->key())->assertOk();
    $this->deleteJson($this->api("members/{$this->boss->id}/roles/{$owner['id']}"), [], $this->key())->assertStatus(422)->assertJson(['code' => 'last_owner']);
});

it('is for organisation owners and admins only, people only', function (): void {
    $roles = $this->asPerson($this->boss)->getJson($this->api('roles'))->json('data');
    $viewer = collect($roles)->firstWhere('name', 'Viewer');
    $this->asPerson($this->accountant)->postJson($this->api('roles'), ['name' => 'X', 'permissions' => []], $this->key())->assertForbidden();
    $this->putJson($this->api("roles/{$viewer['id']}"), ['permissions' => []], $this->key())->assertForbidden();
    $this->postJson($this->api("roles/{$viewer['id']}/reset"), [], $this->key())->assertForbidden();
    $this->deleteJson($this->api("roles/{$viewer['id']}"), [], $this->key())->assertForbidden();
    $this->asToken($this->newToken(['contacts:read']))->postJson($this->api('roles'), ['name' => 'X', 'permissions' => []], $this->key())->assertForbidden();
});

it('resets the registry per tenant: a change is visible to the next request without a restart', function (): void {
    $this->asPerson($this->boss);
    $viewer = $this->person('Val Viewer', ['Viewer']);
    $roles = ($this->roles)();
    $this->asPerson($viewer)->postJson($this->api('invoices'), $this->t->body($this->t->customer, [[10000, '1', 'VAT10']]), $this->key())->assertForbidden();
    $this->asPerson($this->boss)->putJson($this->api("roles/{$roles['Viewer']['id']}"), ['permissions' => [...$roles['Viewer']['permissions'], 'invoices.create']], $this->key())->assertOk();
    $this->asPerson($viewer)->postJson($this->api('invoices'), $this->t->body($this->t->customer, [[10000, '1', 'VAT10']]), $this->key())->assertCreated();
    expect($this->inTenant(fn () => DB::table('audit_events')->where('action', 'company_role.updated')->count()))->toBe(1);
});
