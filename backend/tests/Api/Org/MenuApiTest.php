<?php

declare(strict_types=1);

use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

beforeEach(function (): void {
    $this->setUpTrade();
    /** @return list<string> every item key in the response */
    $this->keys = fn (array $menu): array => collect($menu['sections'])->flatMap(fn (array $s) => collect($s['items'])->pluck('key'))->all();
});

it('returns only what the role may open, with the permissions behind it', function (): void {
    $accountant = $this->asPerson($this->accountant)->getJson($this->api('menu'))->assertOk()->json('data');
    $keys = ($this->keys)($accountant);
    expect($keys)->toContain('dashboard', 'invoices', 'bills', 'journals', 'budgets', 'purchase_orders', 'settings')
        ->and($keys)->not->toContain('approvals')->not->toContain('audit_log')
        ->and($accountant['permissions'])->toContain('invoices.create')->not->toContain('journals.approve')
        ->and($accountant['org_admin'])->toBeFalse();

    $approver = $this->asPerson($this->approver)->getJson($this->api('menu'))->assertOk()->json('data');
    expect(($this->keys)($approver))->toContain('approvals')->and($approver['permissions'])->toContain('journals.approve');

    $assistant = ($this->keys)($this->asPerson($this->assistant)->getJson($this->api('menu'))->assertOk()->json('data'));
    expect($assistant)->toContain('invoices', 'customers', 'items')->not->toContain('bills')->not->toContain('purchase_orders')->not->toContain('journals');

    $owner = $this->asPerson($this->owner)->getJson($this->api('menu'))->assertOk()->json('data');
    expect(($this->keys)($owner))->toContain('approvals', 'audit_log', 'periods', 'import');
});

it('keeps the section order of the list and omits empty sections', function (): void {
    $assistant = $this->asPerson($this->assistant)->getJson($this->api('menu'))->assertOk()->json('data');
    $titles = collect($assistant['sections'])->pluck('key')->all();
    expect($titles[0])->toBe('main')->and($titles)->not->toContain('banking')->not->toContain('reports');
});

it('hides a row whose permission does not exist and shows it once a role holds it', function (): void {
    // A row seeded ahead of its feature: the permission it needs exists in no role until the feature adds it.
    $owner = DB::connection('pgsql_owner');
    $owner->table('menu_items')->insert([
        'id' => (string) Str::uuid7(), 'key' => 'future_screen', 'section_key' => 'main', 'section_title' => null, 'section_sort' => 10,
        'section_collapsed' => false, 'label' => 'Future', 'icon' => 'package', 'route' => 'future', 'sort_order' => 990,
        'permissions' => json_encode(['future_thing.view']), 'active' => true, 'created_at' => now(), 'updated_at' => now(),
    ]);
    try {
        $before = $this->asPerson($this->owner)->getJson($this->api('menu'))->assertOk()->json('data');
        expect(($this->keys)($before))->not->toContain('future_screen');

        $this->inTenant(function (): void {
            $id = (string) Str::uuid7();
            DB::table('permissions')->insert(['id' => $id, 'tenant_id' => $this->f->tenantId, 'name' => 'future_thing.view', 'guard_name' => 'web']);
            $role = DB::table('roles')->where('company_id', $this->f->companyId)->where('name', 'Owner')->value('id');
            DB::table('role_has_permissions')->insert(['tenant_id' => $this->f->tenantId, 'permission_id' => $id, 'role_id' => $role]);
        });
        $after = $this->asPerson($this->owner)->getJson($this->api('menu'))->assertOk()->json('data');
        expect(($this->keys)($after))->toContain('future_screen');
    } finally {
        $owner->table('menu_items')->where('key', 'future_screen')->delete();
    }
});

it('does not show an inactive row', function (): void {
    DB::connection('pgsql_owner')->table('menu_items')->where('key', 'budgets')->update(['active' => false]);
    try {
        $owner = $this->asPerson($this->owner)->getJson($this->api('menu'))->assertOk()->json('data');
        expect(($this->keys)($owner))->not->toContain('budgets');
    } finally {
        DB::connection('pgsql_owner')->table('menu_items')->where('key', 'budgets')->update(['active' => true]);
    }
});

it('is read-only to the app role and seeds every live item once', function (): void {
    expect(fn () => DB::table('menu_items')->update(['label' => 'x']))->toThrow(QueryException::class)
        ->and(fn () => DB::table('menu_items')->delete())->toThrow(QueryException::class);

    $keys = DB::table('menu_items')->pluck('key')->all();
    expect($keys)->toContain('requisitions', 'purchase_orders', 'goods_receipts', 'procurement_reports', 'budgets', 'fixed_assets', 'recurring_bills', 'debit_notes', 'report_supplier_statement')
        ->and(array_unique($keys))->toHaveCount(count($keys));
});

it('refuses tokens and people outside the company', function (): void {
    $this->asToken($this->newToken(['contacts:read']))->getJson($this->api('menu'))->assertForbidden();
    $beta = $this->secondCompany();
    $this->asPerson($this->accountant)->getJson($this->api('menu', $beta->id))->assertForbidden();
});
