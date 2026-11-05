<?php

declare(strict_types=1);

/*
 * Purchase orders over HTTP (D14): priced on the server, numbered on approval, revised through a second approval, cancelled
 * or closed. None of it touches the ledger.
 */

beforeEach(function (): void {
    $this->setUpTrade();
});

it('prices a draft on the server, with tax, and gives it no number', function (): void {
    $body = $this->orderBody(lines: [[10000, '10', 'VAT10'], [2550, '2']]) + ['total_fc' => 1, 'total' => 1];
    $body['lines'][0] += ['line_total_fc' => 1, 'tax_amount_fc' => 1];

    $this->asPerson($this->accountant)->postJson($this->api('purchase-orders'), $body, $this->key())->assertCreated()
        ->assertJsonPath('data.status', 'draft')->assertJsonPath('data.number', null)->assertJsonPath('data.currency', 'USD')
        ->assertJsonPath('data.contact_name', 'Contact S1')->assertJsonPath('data.revision', 0)->assertJsonPath('data.version', 0)
        ->assertJsonPath('data.subtotal_fc.amount', 105100)->assertJsonPath('data.tax_total_fc.amount', 10000)->assertJsonPath('data.total_fc.amount', 115100)
        ->assertJsonPath('data.total.amount', 115100)->assertJsonPath('data.total.currency', 'USD')
        ->assertJsonPath('data.lines.0.line_total_fc.amount', 100000)->assertJsonPath('data.lines.0.tax_amount_fc.amount', 10000)
        ->assertJsonPath('data.lines.0.quantity', '10.000000')->assertJsonPath('data.lines.0.received', '0.000000')->assertJsonPath('data.lines.0.open_to_receive', '10.000000')
        ->assertJsonPath('data.lines.1.line_total_fc.amount', 5100)->assertJsonPath('data.open_revision_id', null)
        ->assertJsonPath('data.can.update', true)->assertJsonPath('data.can.approve', false)->assertJsonPath('data.can.receive', false);
    expect($this->journalCount())->toBe(0);
});

it('goes to a second person for approval, who signs with a PIN, and the order gets PO-FY2026-00001', function (): void {
    $this->workflow('purchase_order');
    $order = $this->draftDoc('purchase-orders', $this->orderBody());
    expect($this->submitDoc('purchase-orders', $order['id'])['status'])->toBe('pending_approval');

    $approved = $this->asPerson($this->approver, signing: true)->postJson($this->api("purchase-orders/{$order['id']}/approve"), [], $this->key())->assertOk()
        ->assertJsonPath('data.status', 'approved')->assertJsonPath('data.number', 'PO-FY2026-00001')->json('data');
    expect($approved['approved_by'])->toBe($this->approver->id)->and($approved['can']['receive'])->toBeFalse();
});

it('does not let the maker approve', function (): void {
    $this->workflow('purchase_order');
    $order = $this->draftDoc('purchase-orders', $this->orderBody());
    $this->submitDoc('purchase-orders', $order['id']);

    $this->asPerson($this->accountant, signing: true)->postJson($this->api("purchase-orders/{$order['id']}/approve"), [], $this->key())->assertForbidden();
    $this->getJson($this->api("purchase-orders/{$order['id']}"))->assertJsonPath('data.status', 'pending_approval')->assertJsonPath('data.number', null);
});

it('numbers orders without gaps, even with a refused approval in between', function (): void {
    $this->workflow('purchase_order');
    $a = $this->draftDoc('purchase-orders', $this->orderBody());
    $b = $this->draftDoc('purchase-orders', $this->orderBody());
    $this->submitDoc('purchase-orders', $a['id']);
    $this->submitDoc('purchase-orders', $b['id']);

    $approve = fn (string $id, $by) => $this->asPerson($by, signing: true)->postJson($this->api("purchase-orders/{$id}/approve"), [], $this->key());
    $approve($a['id'], $this->accountant)->assertForbidden();
    $approve($a['id'], $this->approver)->assertOk()->assertJsonPath('data.number', 'PO-FY2026-00001');
    $approve($a['id'], $this->approver)->assertStatus(403);
    $approve($b['id'], $this->accountant)->assertForbidden();
    $approve($b['id'], $this->approver)->assertOk()->assertJsonPath('data.number', 'PO-FY2026-00002');
});

it('cannot set up a workflow of its own for revisions, which use the purchase_order workflow', function (): void {
    $this->asPerson($this->owner)->postJson($this->api('approval-workflows'), [
        'document_type' => 'purchase_order_revision', 'name' => 'Revisions', 'source' => 'any', 'min_amount' => 0, 'steps' => [['role' => 'Approver']],
    ], $this->key())->assertStatus(422);
});

it('refuses to edit an approved order, which changes through a revision', function (): void {
    $order = $this->approvedOrder();

    $this->asPerson($this->accountant)->putJson($this->api("purchase-orders/{$order['id']}"), [...$this->orderBody(), 'version' => $order['version']], $this->key())->assertForbidden();
    $this->getJson($this->api("purchase-orders/{$order['id']}"))->assertJsonPath('data.can.update', false)->assertJsonPath('data.can.revise', true);
});

it('leaves the order unchanged until the revision is approved, and receipts still work while it waits', function (): void {
    $order = $this->approvedOrder($this->orderBody(lines: [[10000, '10'], [500, '4']]));
    $this->workflow('purchase_order');

    $revision = $this->asPerson($this->accountant)->postJson($this->api("purchase-orders/{$order['id']}/revisions"), $this->reviseBody($order, [0 => ['unit_price_fc' => 12000]]), $this->key())
        ->assertCreated()->assertJsonPath('data.status', 'draft')->assertJsonPath('data.revision_no', null)->assertJsonPath('data.total.amount', 122000)->json('data');
    $this->getJson($this->api("purchase-orders/{$order['id']}"))->assertJsonPath('data.open_revision_id', $revision['id'])->assertJsonPath('data.total_fc.amount', 102000);
    $this->submitDoc('purchase-order-revisions', $revision['id']);

    $this->getJson($this->api("purchase-orders/{$order['id']}"))->assertJsonPath('data.total_fc.amount', 102000)->assertJsonPath('data.revision', 0)
        ->assertJsonPath('data.lines.0.unit_price_fc.amount', 10000);
    $this->receive($order['id'], [[$order['lines'][0]['id'], '3']])->assertCreated();
});

it('approves a revision, an order and a requisition from the inbox and says so', function (): void {
    $order = $this->approvedOrder();
    $this->workflow('purchase_order');
    $this->workflow('purchase_requisition');
    $revision = $this->draftDoc("purchase-orders/{$order['id']}/revisions", $this->reviseBody($order, [0 => ['unit_price_fc' => 12000]]));
    $this->submitDoc('purchase-order-revisions', $revision['id']);
    $next = $this->draftDoc('purchase-orders', $this->orderBody());
    $this->submitDoc('purchase-orders', $next['id']);
    $requisition = $this->draftDoc('purchase-requisitions', $this->reqBody());
    $this->submitDoc('purchase-requisitions', $requisition['id']);

    $this->asPerson($this->approver)->getJson($this->api('approvals'))->assertOk()->assertJsonCount(3, 'data');
    $this->asPerson($this->approver, signing: true)->postJson($this->api('approvals/bulk-approve'), ['documents' => [
        ['type' => 'purchase_order_revision', 'id' => $revision['id']],
        ['type' => 'purchase_order', 'id' => $next['id']],
        ['type' => 'purchase_requisition', 'id' => $requisition['id']],
    ]], $this->key())->assertOk()
        ->assertJsonPath('meta.approved', 3)->assertJsonPath('meta.skipped', 0)
        ->assertJsonPath('data.0.number', null)->assertJsonPath('data.1.number', 'PO-FY2026-00002')->assertJsonPath('data.2.number', 'PR-FY2026-00001');
    $this->getJson($this->api("purchase-orders/{$order['id']}"))->assertJsonPath('data.revision', 1)->assertJsonPath('data.lines.0.unit_price_fc.amount', 12000);
});

it('allows one open revision per order', function (): void {
    $order = $this->approvedOrder();
    $body = $this->reviseBody($order, [0 => ['unit_price_fc' => 12000]]);

    $this->asPerson($this->accountant)->postJson($this->api("purchase-orders/{$order['id']}/revisions"), $body, $this->key())->assertCreated();
    $this->postJson($this->api("purchase-orders/{$order['id']}/revisions"), $body, $this->key())->assertStatus(422)->assertJsonPath('code', 'order_has_open_revision');
    $this->postJson($this->api("purchase-orders/{$order['id']}/revisions"), [...$body, 'reason' => ''], $this->key())->assertStatus(422);
});

it('applies a revision approved by a second person, keeping revision 1 with before and after, and the line ids', function (): void {
    $order = $this->approvedOrder($this->orderBody(lines: [[10000, '10'], [500, '4']]));
    $this->workflow('purchase_order');
    $revision = $this->asPerson($this->accountant)->postJson($this->api("purchase-orders/{$order['id']}/revisions"), $this->reviseBody($order, [0 => ['unit_price_fc' => 12000, 'quantity' => '8']]), $this->key())
        ->assertCreated()->json('data');
    $this->submitDoc('purchase-order-revisions', $revision['id']);

    $this->asPerson($this->accountant, signing: true)->postJson($this->api("purchase-order-revisions/{$revision['id']}/approve"), [], $this->key())->assertForbidden();
    $applied = $this->asPerson($this->approver, signing: true)->postJson($this->api("purchase-order-revisions/{$revision['id']}/approve"), [], $this->key())->assertOk()
        ->assertJsonPath('data.status', 'applied')->assertJsonPath('data.revision_no', 1)->json('data');
    expect($applied['before']['totals']['total_fc'])->toBe(102000)->and($applied['after']['totals']['total_fc'])->toBe(98000)
        ->and($applied['applied_at'])->not->toBeNull()->and($applied['approved_by'])->toBe($this->approver->id);

    $now = $this->getJson($this->api("purchase-orders/{$order['id']}"))->assertJsonPath('data.revision', 1)->assertJsonPath('data.number', $order['number'])
        ->assertJsonPath('data.total_fc.amount', 98000)->assertJsonPath('data.status', 'approved')->assertJsonPath('data.open_revision_id', null)->json('data');
    expect(array_column($now['lines'], 'id'))->toBe(array_column($order['lines'], 'id'));
    $this->getJson($this->api("purchase-orders/{$order['id']}/revisions"))->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $revision['id']);
});

it('refuses at apply a quantity below what was received after the revision was submitted', function (): void {
    $order = $this->approvedOrder();
    $this->workflow('purchase_order');
    $revision = $this->asPerson($this->accountant)->postJson($this->api("purchase-orders/{$order['id']}/revisions"), $this->reviseBody($order, [0 => ['quantity' => '6']]), $this->key())->assertCreated()->json('data');
    $this->submitDoc('purchase-order-revisions', $revision['id']);
    $this->receive($order['id'], [[$order['lines'][0]['id'], '8']])->assertCreated();

    $this->asPerson($this->approver, signing: true)->postJson($this->api("purchase-order-revisions/{$revision['id']}/approve"), [], $this->key())
        ->assertStatus(422)->assertJsonPath('code', 'revision_quantity_below_used');
    $this->getJson($this->api("purchase-orders/{$order['id']}"))->assertJsonPath('data.revision', 0)->assertJsonPath('data.lines.0.quantity', '10.000000');
});

it('refuses to remove a line that has receipts', function (): void {
    $order = $this->approvedOrder($this->orderBody(lines: [[10000, '10'], [500, '4']]));
    $this->workflow('purchase_order');
    $this->receive($order['id'], [[$order['lines'][1]['id'], '1']])->assertCreated();
    $revision = $this->asPerson($this->accountant)->postJson($this->api("purchase-orders/{$order['id']}/revisions"), $this->reviseBody($order, [1 => null]), $this->key())->assertCreated()->json('data');

    $this->asPerson($this->accountant, signing: true)->postJson($this->api("purchase-order-revisions/{$revision['id']}/submit"), [], $this->key())
        ->assertStatus(422)->assertJsonPath('code', 'revision_line_in_use');
});

it('matches the next bill against the price a revision changed', function (): void {
    $order = $this->approvedOrder();
    $revision = $this->asPerson($this->accountant)->postJson($this->api("purchase-orders/{$order['id']}/revisions"), $this->reviseBody($order, [0 => ['unit_price_fc' => 12000]]), $this->key())->assertCreated()->json('data');
    $this->submitDoc('purchase-order-revisions', $revision['id']);
    $this->getJson($this->api("purchase-orders/{$order['id']}"))->assertJsonPath('data.revision', 1)->assertJsonPath('data.lines.0.unit_price_fc.amount', 12000);

    $this->receive($order['id'], [[$order['lines'][0]['id'], '10']])->assertCreated();
    $bill = $this->billOf($order['id']);
    expect($bill['lines'][0]['unit_price_fc']['amount'])->toBe(12000);
    $this->submitBill($bill['id'])->assertOk()->assertJsonPath('data.status', 'posted');
});

it('leaves the order alone when a revision is voided', function (): void {
    $order = $this->approvedOrder();
    $revision = $this->asPerson($this->accountant)->postJson($this->api("purchase-orders/{$order['id']}/revisions"), $this->reviseBody($order, [0 => ['unit_price_fc' => 12000]]), $this->key())->assertCreated()->json('data');

    $this->postJson($this->api("purchase-order-revisions/{$revision['id']}/void"), ['reason' => 'Changed our mind'], $this->key())->assertOk()->assertJsonPath('data.status', 'void');
    $this->getJson($this->api("purchase-orders/{$order['id']}"))->assertJsonPath('data.revision', 0)->assertJsonPath('data.total_fc.amount', 100000)->assertJsonPath('data.open_revision_id', null);
    $this->postJson($this->api("purchase-orders/{$order['id']}/revisions"), $this->reviseBody($order, [0 => ['unit_price_fc' => 11000]]), $this->key())->assertCreated();
});

it('cancels a draft by its maker, and an approved order by a person who may, which keeps its number', function (): void {
    $draft = $this->draftDoc('purchase-orders', $this->orderBody());
    $this->asPerson($this->accountant)->postJson($this->api("purchase-orders/{$draft['id']}/cancel"), [], $this->key())->assertStatus(422);
    $this->postJson($this->api("purchase-orders/{$draft['id']}/cancel"), ['reason' => 'Not needed'], $this->key())->assertOk()
        ->assertJsonPath('data.status', 'cancelled')->assertJsonPath('data.cancel_reason', 'Not needed')->assertJsonPath('data.number', null);

    $approved = $this->approvedOrder();
    $this->asPerson($this->accountant)->postJson($this->api("purchase-orders/{$approved['id']}/cancel"), ['reason' => 'x'], $this->key())->assertForbidden();
    $this->asPerson($this->owner)->postJson($this->api("purchase-orders/{$approved['id']}/cancel"), ['reason' => 'Supplier closed'], $this->key())->assertOk()
        ->assertJsonPath('data.status', 'cancelled')->assertJsonPath('data.number', 'PO-FY2026-00001');
});

it('refuses to cancel an order that has a receipt or a bill waiting for approval', function (): void {
    $order = $this->approvedOrder();
    $this->workflow('bill');
    $bill = $this->billOf($order['id']);
    $this->submitBill($bill['id'], 'Invoice came before the goods', $this->owner)->assertOk()->assertJsonPath('data.status', 'pending_approval');

    $this->asPerson($this->owner)->postJson($this->api("purchase-orders/{$order['id']}/cancel"), ['reason' => 'Too late'], $this->key())->assertStatus(422)->assertJsonPath('code', 'order_has_activity');

    // Once goods arrive the order is partly received, which can no longer be cancelled: the policy says so up front.
    $this->receive($order['id'], [[$order['lines'][0]['id'], '1']])->assertCreated();
    $this->getJson($this->api("purchase-orders/{$order['id']}"))->assertJsonPath('data.can.cancel', false);
    $this->postJson($this->api("purchase-orders/{$order['id']}/cancel"), ['reason' => 'Too late'], $this->key())->assertForbidden();
});

it('refuses to close an order with unbilled receipts and closes it once billed, after which it takes no receipts or bills', function (): void {
    $order = $this->approvedOrder();
    $line = $order['lines'][0]['id'];
    $this->receive($order['id'], [[$line, '4']])->assertCreated();

    $this->asPerson($this->owner)->postJson($this->api("purchase-orders/{$order['id']}/close"), [], $this->key())->assertStatus(422)->assertJsonPath('code', 'order_has_unbilled_receipts');

    $bill = $this->billOf($order['id']);
    $this->submitBill($bill['id'])->assertOk();
    $this->asPerson($this->owner)->postJson($this->api("purchase-orders/{$order['id']}/close"), [], $this->key())->assertOk()
        ->assertJsonPath('data.status', 'closed')->assertJsonPath('data.can.receive', false)->assertJsonPath('data.can.bill', false);

    $this->receive($order['id'], [[$line, '1']])->assertStatus(422)->assertJsonPath('code', 'order_not_open');
    $this->asPerson($this->accountant)->postJson($this->api("purchase-orders/{$order['id']}/bill"), [], $this->key())->assertForbidden();
});

it('writes no journal at any point of the procurement flow before a bill', function (): void {
    $this->workflow('purchase_requisition');
    $this->workflow('purchase_order');
    $pr = $this->draftDoc('purchase-requisitions', $this->reqBody());
    $this->submitDoc('purchase-requisitions', $pr['id']);
    $pr = $this->asPerson($this->approver, signing: true)->postJson($this->api("purchase-requisitions/{$pr['id']}/approve"), [], $this->key())->assertOk()->json('data');
    expect($this->journalCount())->toBe(0);

    $order = $this->asPerson($this->accountant)->postJson($this->api("purchase-requisitions/{$pr['id']}/convert"), [
        'contact_id' => $this->t->supplier, 'order_date' => '2026-03-12', 'lines' => [['requisition_line_id' => $pr['lines'][0]['id']]],
    ], $this->key())->assertCreated()->json('data');
    $this->submitDoc('purchase-orders', $order['id']);
    $order = $this->asPerson($this->approver, signing: true)->postJson($this->api("purchase-orders/{$order['id']}/approve"), [], $this->key())->assertOk()->json('data');
    expect($this->journalCount())->toBe(0);

    $this->receive($order['id'], [[$order['lines'][0]['id'], '1']])->assertCreated();
    $revision = $this->asPerson($this->accountant)->postJson($this->api("purchase-orders/{$order['id']}/revisions"), $this->reviseBody($order, [0 => ['unit_price_fc' => 6000]]), $this->key())->assertCreated()->json('data');
    $this->submitDoc('purchase-order-revisions', $revision['id']);
    $this->asPerson($this->approver, signing: true)->postJson($this->api("purchase-order-revisions/{$revision['id']}/approve"), [], $this->key())->assertOk();
    $this->billOf($order['id']);

    expect($this->journalCount())->toBe(0);
});

it('answers 403 to a user without the permission on every mutating route', function (): void {
    $order = $this->approvedOrder();
    $draft = $this->draftDoc('purchase-orders', $this->orderBody());
    $revision = $this->asPerson($this->accountant)->postJson($this->api("purchase-orders/{$order['id']}/revisions"), $this->reviseBody($order, [0 => ['unit_price_fc' => 12000]]), $this->key())->assertCreated()->json('data');
    $receipt = $this->receive($order['id'], [[$order['lines'][0]['id'], '1']])->assertCreated()->json('data');
    $line = $order['lines'][0]['id'];

    $routes = [
        ['post', 'purchase-orders', $this->orderBody()],
        ['put', "purchase-orders/{$draft['id']}", [...$this->orderBody(), 'version' => 0]],
        ['post', "purchase-orders/{$draft['id']}/submit", []],
        ['post', "purchase-orders/{$order['id']}/approve", []],
        ['post', "purchase-orders/{$draft['id']}/return", ['comment' => 'x']],
        ['post', "purchase-orders/{$order['id']}/cancel", ['reason' => 'x']],
        ['post', "purchase-orders/{$order['id']}/close", []],
        ['post', "purchase-orders/{$order['id']}/revisions", $this->reviseBody($order)],
        ['post', "purchase-orders/{$order['id']}/bill", []],
        ['put', "purchase-order-revisions/{$revision['id']}", [...$this->reviseBody($order), 'version' => 0]],
        ['post', "purchase-order-revisions/{$revision['id']}/submit", []],
        ['post', "purchase-order-revisions/{$revision['id']}/void", []],
        ['post', 'goods-receipts', ['purchase_order_id' => $order['id'], 'receipt_date' => '2026-03-20', 'lines' => [['order_line_id' => $line, 'quantity' => '1']]]],
        ['post', "goods-receipts/{$receipt['id']}/reverse", ['reason' => 'x']],
        ['post', "goods-receipts/{$receipt['id']}/bill", []],
        ['post', 'purchase-requisitions', $this->reqBody()],
    ];
    $this->asPerson($this->assistant);
    foreach ($routes as [$method, $path, $body]) {
        $this->{$method.'Json'}($this->api($path), $body, $this->key())->assertForbidden();
    }
    $this->getJson($this->api('purchase-orders'))->assertForbidden();
    $this->getJson($this->api("purchase-orders/{$order['id']}"))->assertForbidden();
});

it('serves the print data as the plain GET of one order', function (): void {
    $order = $this->approvedOrder($this->orderBody(lines: [[10000, '10', 'VAT10']]));
    $this->receive($order['id'], [[$order['lines'][0]['id'], '4']])->assertCreated();

    $this->asPerson($this->owner)->getJson($this->api("purchase-orders/{$order['id']}"))->assertOk()
        ->assertJsonPath('data.number', 'PO-FY2026-00001')->assertJsonPath('data.contact_name', 'Contact S1')->assertJsonPath('data.reference', 'Quote 9')
        ->assertJsonPath('data.lines.0.received', '4.000000')->assertJsonPath('data.lines.0.open_to_receive', '6.000000')
        ->assertJsonPath('data.lines.0.received_not_billed', '4.000000')->assertJsonPath('data.lines.0.billed', '0.000000')
        ->assertJsonPath('data.status', 'partly_received')->assertJsonPath('data.lines.0.tax_amount_fc.amount', 10000);
});
