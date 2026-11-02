<?php

declare(strict_types=1);

use App\Actions\Organisation\AssignCompanyRole;
use App\Actions\Organisation\CreateCompany;
use App\Actions\Organisation\Inputs\CompanyRoleInput;
use App\Actions\Organisation\Inputs\CreateCompanyInput;
use App\Actions\Organisation\SeedCompanyRoles;
use App\Actions\Trade\CreateInvoiceDraft;
use App\Actions\Trade\Inputs\InvoiceDraftInput;
use App\Actions\Trade\Inputs\InvoiceLineInput;
use App\Domain\Organisation\PermissionMatrix;
use App\Domain\Trade\InvoiceKind;
use App\Support\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\LedgerFixture;

/*
 * The eight procurement tables as the app role sees them: tenant isolation, the composite company FKs, the immutability
 * triggers, the maker/checker CHECKs, and the permission backfill for companies that existed before procurement.
 */

const PROCUREMENT_TABLES = [
    'purchase_requisitions', 'purchase_requisition_lines', 'purchase_orders', 'purchase_order_lines',
    'purchase_order_revisions', 'goods_receipts', 'goods_receipt_lines', 'bill_match_results',
];

function procSqlState(callable $fn): ?string
{
    try {
        $fn();
    } catch (QueryException|PDOException $e) {
        return (string) $e->getCode();
    }

    return null;
}

/**
 * One of everything in a company, by plain inserts (the tenant context is set).
 *
 * @return array<string, string>
 */
function procurementRows(string $tenantId, string $companyId): array
{
    $id = fn (): string => (string) Str::uuid7();
    $scope = ['tenant_id' => $tenantId, 'company_id' => $companyId];
    $r = ['account' => $id(), 'supplier' => $id(), 'pr' => $id(), 'prLine' => $id(), 'po' => $id(), 'poLine' => $id(), 'rev' => $id(), 'grn' => $id(), 'grnLine' => $id()];

    DB::table('accounts')->insert([...$scope, 'id' => $r['account'], 'code' => 'P'.random_int(1000, 9999), 'name' => 'Purchases', 'account_type' => 'expense', 'normal_balance' => 'debit']);
    DB::table('contacts')->insert([...$scope, 'id' => $r['supplier'], 'kind' => 'supplier', 'code' => 'S'.random_int(1000, 9999), 'name' => 'Supplier', 'default_currency' => 'USD']);
    DB::table('purchase_requisitions')->insert([...$scope, 'id' => $r['pr'], 'status' => 'draft', 'requisition_date' => '2026-03-10', 'currency' => 'USD', 'total' => 1000]);
    DB::table('purchase_requisition_lines')->insert([...$scope, 'id' => $r['prLine'], 'purchase_requisition_id' => $r['pr'], 'line_no' => 1, 'description' => 'Paper', 'quantity' => '1', 'estimated_unit_price' => 1000, 'line_total' => 1000]);
    DB::table('purchase_orders')->insert([...$scope, 'id' => $r['po'], 'status' => 'approved', 'number' => 'PO-'.random_int(100000, 999999), 'contact_id' => $r['supplier'], 'order_date' => '2026-03-12', 'currency' => 'USD', 'subtotal_fc' => 5000, 'total_fc' => 5000, 'subtotal' => 5000, 'total' => 5000]);
    DB::table('purchase_order_lines')->insert([...$scope, 'id' => $r['poLine'], 'purchase_order_id' => $r['po'], 'line_no' => 1, 'account_id' => $r['account'], 'quantity' => '5', 'unit_price_fc' => 1000, 'line_total_fc' => 5000]);
    DB::table('purchase_order_revisions')->insert([...$scope, 'id' => $r['rev'], 'purchase_order_id' => $r['po'], 'reason' => 'Reprice', 'proposed' => '{}']);
    DB::table('goods_receipts')->insert([...$scope, 'id' => $r['grn'], 'purchase_order_id' => $r['po'], 'number' => 'GRN-'.random_int(100000, 999999), 'receipt_date' => '2026-03-20']);
    DB::table('goods_receipt_lines')->insert([...$scope, 'id' => $r['grnLine'], 'goods_receipt_id' => $r['grn'], 'purchase_order_line_id' => $r['poLine'], 'line_no' => 1, 'quantity' => '2']);

    return $r;
}

/** A draft bill in the fixture's company, through the Action, plus its match result. */
function billWithResult(LedgerFixture $f, array $rows): string
{
    $line = new InvoiceLineInput('1', accountId: $rows['account'], unitPriceFc: 1000);
    $bill = app(CreateInvoiceDraft::class)->handle($f->actor, new InvoiceDraftInput($f->companyId, InvoiceKind::PurchaseBill, $rows['supplier'], new DateTimeImmutable('2026-03-15'), [$line]));
    DB::table('bill_match_results')->insert([
        'id' => (string) Str::uuid7(), 'tenant_id' => $f->tenantId, 'company_id' => $f->companyId, 'invoice_id' => $bill->id,
        'outcome' => 'matched', 'violations' => '[]', 'created_at' => now(),
    ]);

    return $bill->id;
}

beforeEach(function (): void {
    $this->f = LedgerFixture::create();
    app(SeedCompanyRoles::class)->handle($this->f->actor, $this->f->companyId);
    app(AssignCompanyRole::class)->handle($this->f->actor, new CompanyRoleInput($this->f->userId, $this->f->companyId, 'Owner'));
    $this->rows = procurementRows($this->f->tenantId, $this->f->companyId);
    $this->billId = billWithResult($this->f, $this->rows);
});

it('hides every procurement table from another tenant and blocks its writes', function (): void {
    $template = [];
    foreach (PROCUREMENT_TABLES as $table) {
        expect(DB::table($table)->count())->toBeGreaterThan(0, $table);
        $template[$table] = (array) DB::table($table)->first();
    }
    $a = $this->f->tenantId;

    $b = LedgerFixture::create(slug: 'beta');
    expect(app(TenantContext::class)->id())->toBe($b->tenantId);
    foreach (PROCUREMENT_TABLES as $table) {
        expect(DB::table($table)->count())->toBe(0, $table);
        $row = [...$template[$table], 'id' => (string) Str::uuid7()];
        expect(fn () => DB::table($table)->insert($row))->toThrow(QueryException::class, 'row-level security');
        expect(DB::table($table)->where('tenant_id', $a)->update(['tenant_id' => $a]))->toBe(0);
    }
});

it('shows no procurement row when no tenant context is set', function (): void {
    app(TenantContext::class)->clear();

    foreach (PROCUREMENT_TABLES as $table) {
        expect(DB::table($table)->count())->toBe(0, $table);
    }
});

it('rejects an invoice line that links an order line of another company, by the composite foreign key', function (): void {
    $beta = app(CreateCompany::class)->handle($this->f->actor, new CreateCompanyInput('Beta Co', 'US', 'USD', 1));
    $other = procurementRows($this->f->tenantId, $beta->id);
    $line = DB::table('invoice_lines')->where('invoice_id', $this->billId)->value('id');

    expect(procSqlState(fn () => DB::table('invoice_lines')->where('id', $line)->update(['purchase_order_line_id' => $other['poLine']])))->toBe('23503')
        ->and(procSqlState(fn () => DB::table('invoice_lines')->where('id', $line)->update(['goods_receipt_line_id' => $other['grnLine']])))->toBe('23503')
        ->and(procSqlState(fn () => DB::table('invoice_lines')->where('id', $line)->update(['purchase_order_line_id' => $this->rows['poLine'], 'goods_receipt_line_id' => $this->rows['grnLine']])))->toBeNull();
    expect(DB::table('invoice_lines')->where('id', $line)->value('purchase_order_line_id'))->toBe($this->rows['poLine']);
});

it('lets a receipt go from recorded to reversed only, and never be deleted', function (): void {
    $grn = $this->rows['grn'];

    expect(procSqlState(fn () => DB::table('goods_receipts')->where('id', $grn)->update(['receipt_date' => '2026-03-21'])))->toBe('LG002')
        ->and(procSqlState(fn () => DB::table('goods_receipts')->where('id', $grn)->update(['number' => 'GRN-X'])))->toBe('LG002')
        ->and(procSqlState(fn () => DB::table('goods_receipts')->where('id', $grn)->update(['purchase_order_id' => $this->rows['po']])))->toBeNull()
        ->and(procSqlState(fn () => DB::table('goods_receipts')->where('id', $grn)->delete()))->toBe('LG002');

    // The reversal columns must come together (CHECK), then it is final.
    expect(procSqlState(fn () => DB::table('goods_receipts')->where('id', $grn)->update(['status' => 'reversed'])))->toBe('23514')
        ->and(procSqlState(fn () => DB::table('goods_receipts')->where('id', $grn)->update(['status' => 'reversed', 'reversal_reason' => 'Wrong', 'reversed_at' => now()])))->toBeNull()
        ->and(procSqlState(fn () => DB::table('goods_receipts')->where('id', $grn)->update(['status' => 'recorded'])))->toBe('LG002')
        ->and(procSqlState(fn () => DB::table('goods_receipts')->where('id', $grn)->update(['reversal_reason' => 'Changed'])))->toBe('LG002')
        ->and(DB::table('goods_receipts')->where('id', $grn)->value('status'))->toBe('reversed');
});

it('keeps goods receipt lines and bill match results append-only', function (): void {
    $line = $this->rows['grnLine'];
    $result = DB::table('bill_match_results')->value('id');

    expect(procSqlState(fn () => DB::table('goods_receipt_lines')->where('id', $line)->update(['quantity' => '3'])))->toBe('LG002')
        ->and(procSqlState(fn () => DB::table('goods_receipt_lines')->where('id', $line)->delete()))->toBe('LG002')
        ->and(procSqlState(fn () => DB::table('bill_match_results')->where('id', $result)->update(['outcome' => 'overridden', 'reason' => 'x'])))->toBe('LG002')
        ->and(procSqlState(fn () => DB::table('bill_match_results')->where('id', $result)->delete()))->toBe('LG002');
    expect(DB::table('goods_receipt_lines')->where('id', $line)->value('quantity'))->toBe('2.000000');
});

it('requires a reason for an overridden match result', function (): void {
    $row = fn (?string $reason) => DB::table('bill_match_results')->insert([
        'id' => (string) Str::uuid7(), 'tenant_id' => $this->f->tenantId, 'company_id' => $this->f->companyId, 'invoice_id' => $this->billId,
        'outcome' => 'overridden', 'violations' => '[]', 'reason' => $reason, 'created_at' => now(),
    ]);

    expect(procSqlState(fn () => $row(null)))->toBe('23514')->and(procSqlState(fn () => $row('')))->toBe('23514')->and(procSqlState(fn () => $row('Agreed')))->toBeNull();
});

it('rejects an approver who is also the maker on orders, requisitions and revisions, by CHECK', function (): void {
    $user = (string) Str::uuid7();

    expect(procSqlState(fn () => DB::table('purchase_orders')->where('id', $this->rows['po'])->update(['created_by' => $user, 'approved_by' => $user])))->toBe('23514')
        ->and(procSqlState(fn () => DB::table('purchase_requisitions')->where('id', $this->rows['pr'])->update(['created_by' => $user, 'approved_by' => $user])))->toBe('23514')
        ->and(procSqlState(fn () => DB::table('purchase_order_revisions')->where('id', $this->rows['rev'])->update(['created_by' => $user, 'approved_by' => $user])))->toBe('23514')
        ->and(procSqlState(fn () => DB::table('purchase_orders')->where('id', $this->rows['po'])->update(['created_by' => $user, 'approved_by' => (string) Str::uuid7()])))->toBeNull();
});

/** @return list<string> "role|permission" for every procurement permission held by a role of the tenant */
function procurementGrants(string $tenantId): array
{
    return app(TenantContext::class)->run($tenantId, function (): array {
        $pairs = DB::table('role_has_permissions as rp')->join('roles as r', 'r.id', '=', 'rp.role_id')->join('permissions as p', 'p.id', '=', 'rp.permission_id')
            ->select('r.name as role', 'p.name as permission')->get()
            ->filter(fn (object $g): bool => PermissionMatrix::isProcurement($g->permission))
            ->map(fn (object $g): string => "{$g->role}|{$g->permission}")->unique()->sort()->values()->all();

        return $pairs;
    });
}

it('gives an existing company\'s roles the procurement permissions, not the Sales Assistant, and changes nothing when run twice', function (): void {
    $tenant = $this->f->tenantId;
    $expected = procurementGrants($tenant);
    expect($expected)->not->toBe([])->and($expected)->toContain('Owner|purchase_orders.approve', 'Approver|purchase_requisitions.approve', 'Accountant|goods_receipts.create', 'Owner|bills.match_override');

    // As if the company predates procurement: take the new permissions away under the tenant context.
    app(TenantContext::class)->run($tenant, function (): void {
        $ids = DB::table('permissions')->get(['id', 'name'])->filter(fn (object $p): bool => PermissionMatrix::isProcurement($p->name))->pluck('id')->all();
        DB::table('role_has_permissions')->whereIn('permission_id', $ids)->delete();
        DB::table('permissions')->whereIn('id', $ids)->delete();
    });
    expect(procurementGrants($tenant))->toBe([]);

    $migration = require base_path('database/migrations/2026_11_04_000011_backfill_procurement_permissions.php');
    $migration->up();
    $once = procurementGrants($tenant);
    $count = app(TenantContext::class)->run($tenant, fn () => [DB::table('permissions')->count(), DB::table('role_has_permissions')->count()]);

    $migration->up();
    $twice = procurementGrants($tenant);
    $countAgain = app(TenantContext::class)->run($tenant, fn () => [DB::table('permissions')->count(), DB::table('role_has_permissions')->count()]);

    expect($once)->toBe($expected)->and($twice)->toBe($expected)->and($countAgain)->toBe($count)
        ->and(array_filter($once, fn (string $g): bool => str_starts_with($g, 'Sales Assistant|')))->toBe([])
        ->and(array_filter($once, fn (string $g): bool => str_starts_with($g, 'Viewer|') && ! str_ends_with($g, '.view')))->toBe([]);
});
