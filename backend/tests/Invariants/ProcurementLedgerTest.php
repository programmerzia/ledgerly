<?php

declare(strict_types=1);

use Illuminate\Support\Facades\DB;
use Tests\Support\LedgerChecks;
use Tests\Support\MakesApiCalls;
use Tests\Support\ProcurementApi;
use Tests\Support\TradeApi;

uses(MakesApiCalls::class, TradeApi::class, ProcurementApi::class);

/*
 * Procurement is not accounting (D14): requisitions, orders, revisions and receipts reach no ledger code, and a bill made from
 * an order is an ordinary bill. After a whole flow (requisition, order, two receipts, a matched bill, an overridden bill,
 * its reversal, a voided bill and a reversed receipt) every ledger invariant still holds and no number has a gap.
 */

beforeEach(function (): void {
    $this->setUpTrade();
});

it('keeps the ledger invariants and gapless numbers through a full procurement flow', function (): void {
    // Requisition to approved order: nothing is posted.
    $pr = $this->approvedRequisition($this->reqBody([[10000, '10']]));
    $draft = $this->asPerson($this->accountant)->postJson($this->api("purchase-requisitions/{$pr['id']}/convert"), [
        'contact_id' => $this->t->supplier, 'order_date' => '2026-03-12', 'lines' => [['requisition_line_id' => $pr['lines'][0]['id'], 'tax_code_id' => $this->t->tax['VAT10']]],
    ], $this->key())->assertCreated()->json('data');
    $order = $this->submitDoc('purchase-orders', $draft['id']);
    $line = $order['lines'][0]['id'];
    expect($order['number'])->toBe('PO-2026-00001')->and($this->journalCount())->toBe(0);

    // A revision and two receipts, one of them reversed and entered again: still nothing.
    $revision = $this->asPerson($this->accountant)->postJson($this->api("purchase-orders/{$order['id']}/revisions"), $this->reviseBody($order, [0 => ['unit_price_fc' => 10500]]), $this->key())->assertCreated()->json('data');
    $this->submitDoc('purchase-order-revisions', $revision['id']);
    $first = $this->receive($order['id'], [[$line, '4']], '2026-03-20')->assertCreated()->json('data');
    $mistaken = $this->receive($order['id'], [[$line, '5']], '2026-03-21')->assertCreated()->json('data');
    $this->asPerson($this->owner)->postJson($this->api("goods-receipts/{$mistaken['id']}/reverse"), ['reason' => 'Counted twice'], $this->key())->assertOk();
    $second = $this->receive($order['id'], [[$line, '6']], '2026-03-22')->assertCreated()->json('data');
    expect($this->journalCount())->toBe(0)->and($this->inTenant(fn () => LedgerChecks::problems()))->toBe([]);

    // A matched bill from the first receipt posts.
    $matched = $this->asPerson($this->accountant)->postJson($this->api("goods-receipts/{$first['id']}/bill"), ['issue_date' => '2026-03-25'], $this->key())->assertCreated()->json('data');
    $this->submitBill($matched['id'])->assertOk()->assertJsonPath('data.status', 'posted');

    // A bill from the second receipt at a higher price: refused, then overridden by an owner.
    $dear = $this->asPerson($this->accountant)->postJson($this->api("goods-receipts/{$second['id']}/bill"), ['issue_date' => '2026-03-26'], $this->key())->assertCreated()->json('data');
    $this->putJson($this->api("bills/{$dear['id']}"), [
        'contact_id' => $dear['contact_id'], 'issue_date' => $dear['issue_date'], 'due_date' => $dear['due_date'], 'version' => $dear['version'],
        'lines' => [['description' => 'Widget', 'account_id' => $dear['lines'][0]['account_id'], 'quantity' => '6', 'unit_price_fc' => 12000, 'tax_code_id' => $this->t->tax['VAT10'],
            'purchase_order_line_id' => $line, 'goods_receipt_line_id' => $dear['lines'][0]['goods_receipt_line_id']]],
    ], $this->key())->assertOk();
    $this->submitBill($dear['id'])->assertStatus(422)->assertJsonPath('code', 'match_price_mismatch');
    $overridden = $this->submitBill($dear['id'], 'Surcharge agreed', $this->owner)->assertOk()->assertJsonPath('data.status', 'posted')->json('data');
    expect($this->inTenant(fn () => LedgerChecks::problems()))->toBe([]);

    // Reverse the dear bill, void a pending one made from the order, then reverse the second receipt.
    $this->asPerson($this->owner, signing: true)->postJson($this->api("bills/{$overridden['id']}/reverse"), ['date' => '2026-03-28'], $this->key())->assertOk()->assertJsonPath('data.status', 'reversed');
    $this->workflow('bill');
    $again = $this->billOf($order['id']);
    $this->submitBill($again['id'])->assertOk()->assertJsonPath('data.status', 'pending_approval');
    $this->asPerson($this->accountant)->postJson($this->api("bills/{$again['id']}/void"), ['reason' => 'Raised in error'], $this->key())->assertOk()->assertJsonPath('data.status', 'void');
    $this->asPerson($this->owner)->postJson($this->api("goods-receipts/{$second['id']}/reverse"), ['reason' => 'Returned to supplier'], $this->key())->assertOk();

    expect($this->inTenant(fn () => LedgerChecks::problems()))->toBe([]);
    $numbers = $this->inTenant(fn () => [
        'requisitions' => DB::table('purchase_requisitions')->orderBy('number')->pluck('number')->all(),
        'orders' => DB::table('purchase_orders')->orderBy('number')->pluck('number')->all(),
        'receipts' => DB::table('goods_receipts')->orderBy('number')->pluck('number')->all(),
        'bills' => DB::table('invoices')->whereNotNull('number')->orderBy('number')->pluck('number')->all(),
    ]);
    expect($numbers)->toBe([
        'requisitions' => ['PR-2026-00001'], 'orders' => ['PO-2026-00001'],
        'receipts' => ['GRN-2026-00001', 'GRN-2026-00002', 'GRN-2026-00003'], 'bills' => ['BILL-FY2026-00001', 'BILL-FY2026-00002'],
    ]);
});

it('leaves the journals empty after every procurement step that comes before a bill', function (): void {
    $this->workflow('purchase_requisition');
    $this->workflow('purchase_order');
    $steps = [];
    $mark = function (string $step) use (&$steps): void {
        $steps[$step] = $this->journalCount();
    };

    $pr = $this->draftDoc('purchase-requisitions', $this->reqBody());
    $mark('requisition drafted');
    $this->submitDoc('purchase-requisitions', $pr['id']);
    $mark('requisition submitted');
    $pr = $this->asPerson($this->approver, signing: true)->postJson($this->api("purchase-requisitions/{$pr['id']}/approve"), [], $this->key())->assertOk()->json('data');
    $mark('requisition approved');
    $order = $this->asPerson($this->accountant)->postJson($this->api("purchase-requisitions/{$pr['id']}/convert"), [
        'contact_id' => $this->t->supplier, 'order_date' => '2026-03-12', 'lines' => [['requisition_line_id' => $pr['lines'][0]['id']]],
    ], $this->key())->assertCreated()->json('data');
    $mark('converted');
    $this->submitDoc('purchase-orders', $order['id']);
    $order = $this->asPerson($this->approver, signing: true)->postJson($this->api("purchase-orders/{$order['id']}/approve"), [], $this->key())->assertOk()->json('data');
    $mark('order approved');
    $this->receive($order['id'], [[$order['lines'][0]['id'], '1']])->assertCreated();
    $mark('received');
    $this->asPerson($this->owner)->postJson($this->api("purchase-orders/{$order['id']}/cancel"), ['reason' => 'x'], $this->key())->assertForbidden();
    $mark('cancel refused');

    expect(array_values(array_unique($steps)))->toBe([0])->and(count($steps))->toBe(7);
});
