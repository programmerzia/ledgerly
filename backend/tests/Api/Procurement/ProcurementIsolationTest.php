<?php

declare(strict_types=1);

use App\Actions\Organisation\AssignCompanyRole;
use App\Actions\Organisation\Inputs\CompanyRoleInput;
use App\Actions\Organisation\SeedCompanyRoles;
use App\Actions\Procurement\CreateOrderRevision;
use App\Actions\Procurement\CreatePurchaseOrderDraft;
use App\Actions\Procurement\CreateRequisitionDraft;
use App\Actions\Procurement\Inputs\GoodsReceiptInput;
use App\Actions\Procurement\Inputs\OrderDraftInput;
use App\Actions\Procurement\Inputs\OrderLineInput;
use App\Actions\Procurement\Inputs\ReceiptLineInput;
use App\Actions\Procurement\Inputs\RequisitionDraftInput;
use App\Actions\Procurement\Inputs\RequisitionLineInput;
use App\Actions\Procurement\Inputs\RevisionInput;
use App\Actions\Procurement\RecordGoodsReceipt;
use App\Support\Actor;
use App\Support\ActorType;
use App\Support\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\LedgerFixture;
use Tests\Support\TradeFixture;

/*
 * RLS separates tenants, not companies (13 §6): ids of another company or another tenant are 404 on every procurement
 * route that binds one, and ids in a request body are validation errors.
 */

/**
 * One requisition, approved order, revision and receipt in a company, written through the Actions.
 *
 * @return array{pr: string, prLine: string, po: string, poLine: string, rev: string, grn: string, grnLine: string}
 */
function procurementDocsIn(string $tenantId, string $companyId, string $accountId, string $supplierId, Actor $actor): array
{
    return app(TenantContext::class)->run($tenantId, function () use ($companyId, $accountId, $supplierId, $actor): array {
        $pr = app(CreateRequisitionDraft::class)->handle($actor, new RequisitionDraftInput($companyId, new DateTimeImmutable('2026-03-10'), [new RequisitionLineInput('1', 1000, description: 'Paper', accountId: $accountId)]));
        $line = new OrderLineInput('5', description: 'Widget', accountId: $accountId, unitPriceFc: 1000);
        $po = app(CreatePurchaseOrderDraft::class)->handle($actor, new OrderDraftInput($companyId, $supplierId, new DateTimeImmutable('2026-03-12'), [$line]));
        DB::table('purchase_orders')->where('id', $po->id)->update(['status' => 'approved', 'number' => 'PO-2026-00001', 'approved_at' => '2026-03-12 10:00:00+00']);
        $poLine = (string) DB::table('purchase_order_lines')->where('purchase_order_id', $po->id)->value('id');
        $rev = app(CreateOrderRevision::class)->handle($actor, $po->id, null, new RevisionInput('Reprice', [new OrderLineInput('5', id: $poLine, description: 'Widget', accountId: $accountId, unitPriceFc: 1200)]));
        $grn = app(RecordGoodsReceipt::class)->handle($actor, new GoodsReceiptInput($companyId, $po->id, new DateTimeImmutable('2026-03-20'), [new ReceiptLineInput($poLine, '1')]));

        return [
            'pr' => $pr->id, 'prLine' => (string) DB::table('purchase_requisition_lines')->where('purchase_requisition_id', $pr->id)->value('id'),
            'po' => $po->id, 'poLine' => $poLine, 'rev' => $rev->id, 'grn' => $grn->id,
            'grnLine' => (string) DB::table('goods_receipt_lines')->where('goods_receipt_id', $grn->id)->value('id'),
        ];
    });
}

beforeEach(function (): void {
    $this->setUpTrade();
    $this->beta = $this->secondCompany();
    $this->both = $this->person('Both Owner', ['Owner']);
    $this->inTenant(fn () => app(AssignCompanyRole::class)->handle($this->f->actor, new CompanyRoleInput($this->both->id, $this->beta->id, 'Owner')));

    $this->inBeta = $this->inTenant(function (): array {
        $account = (string) Str::uuid7();
        $supplier = (string) Str::uuid7();
        DB::table('accounts')->insert(['id' => $account, 'tenant_id' => $this->f->tenantId, 'company_id' => $this->beta->id, 'code' => '5000', 'name' => 'B Expense', 'account_type' => 'expense', 'normal_balance' => 'debit']);
        DB::table('contacts')->insert(['id' => $supplier, 'tenant_id' => $this->f->tenantId, 'company_id' => $this->beta->id, 'kind' => 'supplier', 'code' => 'B-S', 'name' => 'B', 'default_currency' => 'USD']);

        return procurementDocsIn($this->f->tenantId, $this->beta->id, $account, $supplier, new Actor(ActorType::User, $this->both->id, $this->f->tenantId, $this->beta->id));
    });

    $other = LedgerFixture::create('USD', 'globex');
    app(TenantContext::class)->run($other->tenantId, function () use ($other): void {
        app(SeedCompanyRoles::class)->handle($other->actor, $other->companyId);
        app(AssignCompanyRole::class)->handle($other->actor, new CompanyRoleInput($other->userId, $other->companyId, 'Owner'));
    });
    $otherTrade = TradeFixture::prepare($other);
    $this->inOtherTenant = procurementDocsIn($other->tenantId, $other->companyId, $other->account('5000'), $otherTrade->supplier, $other->actor);
});

/** @return list<array{0: string, 1: string}> */
function procurementRoutes(array $ids): array
{
    $routes = [];
    foreach ([['GET', ''], ['PUT', ''], ['POST', '/submit'], ['POST', '/approve'], ['POST', '/return'], ['POST', '/void'], ['POST', '/reject'], ['POST', '/convert']] as [$method, $suffix]) {
        $routes[] = [$method, "purchase-requisitions/{$ids['pr']}{$suffix}"];
    }
    foreach ([['GET', ''], ['PUT', ''], ['POST', '/submit'], ['POST', '/approve'], ['POST', '/return'], ['POST', '/cancel'], ['POST', '/close'], ['GET', '/receipts'], ['GET', '/bills'], ['GET', '/revisions'], ['POST', '/revisions'], ['POST', '/bill']] as [$method, $suffix]) {
        $routes[] = [$method, "purchase-orders/{$ids['po']}{$suffix}"];
    }
    foreach ([['GET', ''], ['PUT', ''], ['POST', '/submit'], ['POST', '/approve'], ['POST', '/return'], ['POST', '/void']] as [$method, $suffix]) {
        $routes[] = [$method, "purchase-order-revisions/{$ids['rev']}{$suffix}"];
    }
    foreach ([['GET', ''], ['POST', '/reverse'], ['POST', '/bill']] as [$method, $suffix]) {
        $routes[] = [$method, "goods-receipts/{$ids['grn']}{$suffix}"];
    }

    return $routes;
}

it('answers 404 on every route with an id of another company of the same tenant', function (): void {
    $this->asPerson($this->both, signing: true);
    foreach (procurementRoutes($this->inBeta) as [$method, $path]) {
        $this->json($method, $this->api($path), [], $this->key())->assertNotFound()->assertJson(['code' => 'not_found']);
    }

    // The same ids under their own company are found, so the 404s are about the company and nothing else.
    $this->getJson($this->api("purchase-requisitions/{$this->inBeta['pr']}", $this->beta->id))->assertOk();
    $this->getJson($this->api("purchase-orders/{$this->inBeta['po']}", $this->beta->id))->assertOk()->assertJsonPath('data.open_revision_id', $this->inBeta['rev']);
    $this->getJson($this->api("purchase-order-revisions/{$this->inBeta['rev']}", $this->beta->id))->assertOk();
    $this->getJson($this->api("goods-receipts/{$this->inBeta['grn']}", $this->beta->id))->assertOk();

    foreach (['purchase-requisitions', 'purchase-orders', 'goods-receipts'] as $list) {
        $this->getJson($this->api($list))->assertOk()->assertJsonCount(0, 'data');
        $this->getJson($this->api($list, $this->beta->id))->assertOk()->assertJsonCount(1, 'data');
    }
    $this->getJson($this->api('procurement/open-commitments'))->assertJsonCount(0, 'data');
    $this->getJson($this->api('procurement/awaiting-receipt'))->assertJsonCount(0, 'data');
});

it('answers 404 on every route with an id of another tenant', function (): void {
    $this->asPerson($this->both, signing: true);
    foreach (procurementRoutes($this->inOtherTenant) as [$method, $path]) {
        $this->json($method, $this->api($path), [], $this->key())->assertNotFound()->assertJson(['code' => 'not_found']);
    }
});

it('refuses ids of another company or tenant inside a request body', function (): void {
    $this->asPerson($this->both);
    $own = $this->approvedOrder();
    $ownLine = $own['lines'][0]['id'];

    foreach ([$this->inBeta, $this->inOtherTenant] as $foreign) {
        $this->postJson($this->api('goods-receipts'), ['purchase_order_id' => $foreign['po'], 'receipt_date' => '2026-03-20', 'lines' => [['order_line_id' => $foreign['poLine'], 'quantity' => '1']]], $this->key())->assertStatus(422);
        $this->postJson($this->api('goods-receipts'), ['purchase_order_id' => $own['id'], 'receipt_date' => '2026-03-20', 'lines' => [['order_line_id' => $foreign['poLine'], 'quantity' => '1']]], $this->key())->assertStatus(422)->assertJsonPath('code', 'receipt_line_invalid');
        $clash = $this->orderBody(extra: ['lines' => [['id' => $foreign['poLine'], 'description' => 'x', 'quantity' => '1', 'unit_price_fc' => 1, 'account_id' => $this->f->account('5000')]]]);
        $this->postJson($this->api('purchase-orders'), $clash, $this->key())->assertStatus(422);
        $this->postJson($this->api("purchase-requisitions/{$foreign['pr']}/convert"), [], $this->key())->assertNotFound();
    }

    $approved = $this->approvedRequisition();
    $this->postJson($this->api("purchase-requisitions/{$approved['id']}/convert"), [
        'contact_id' => $this->t->supplier, 'order_date' => '2026-03-12', 'lines' => [['requisition_line_id' => $this->inBeta['prLine']]],
    ], $this->key())->assertStatus(422);
    $this->postJson($this->api("purchase-orders/{$own['id']}/revisions"), [
        'reason' => 'x', 'lines' => [['id' => $ownLine, 'quantity' => '1', 'unit_price_fc' => 1, 'account_id' => $this->inBeta['poLine']]],
    ], $this->key())->assertStatus(422);
});

it('refuses a bill line that links another company\'s order or receipt line', function (): void {
    $this->asPerson($this->both);

    foreach ([$this->inBeta, $this->inOtherTenant] as $foreign) {
        foreach (['purchase_order_line_id' => 'poLine', 'goods_receipt_line_id' => 'grnLine'] as $field => $key) {
            $body = $this->t->body($this->t->supplier, [[1000, '1', null, '0', '5000']]);
            $body['lines'][0][$field] = $foreign[$key];
            $this->postJson($this->api('bills'), $body, $this->key())->assertStatus(422)->assertJsonValidationErrors(["lines.0.{$field}"]);
        }
    }
});
