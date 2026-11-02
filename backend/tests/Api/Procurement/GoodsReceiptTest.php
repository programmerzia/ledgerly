<?php

declare(strict_types=1);

/*
 * Goods receipts over HTTP (D14): quantities against an approved order, never edited, reversed with a reason, and never a journal.
 */

beforeEach(function (): void {
    $this->setUpTrade();
    $this->order = $this->approvedOrder($this->orderBody(lines: [[10000, '10'], [500, '4']]));
    $this->line1 = $this->order['lines'][0]['id'];
    $this->line2 = $this->order['lines'][1]['id'];
});

it('moves the order through approved, partly received and received with two partial receipts', function (): void {
    $first = $this->receive($this->order['id'], [[$this->line1, '6'], [$this->line2, '4']])->assertCreated()
        ->assertJsonPath('data.status', 'recorded')->assertJsonPath('data.number', 'GRN-2026-00001')->assertJsonPath('data.order_number', 'PO-2026-00001')
        ->assertJsonPath('data.contact_name', 'Contact S1')->assertJsonPath('data.lines.0.quantity', '6.000000')->assertJsonPath('data.lines.0.order_line_id', $this->line1)
        ->assertJsonPath('data.lines.0.line_no', 1)->assertJsonPath('data.lines.0.description', 'Widget')->assertJsonPath('data.reference', 'DN-1')->json('data');
    $this->getJson($this->api("purchase-orders/{$this->order['id']}"))->assertJsonPath('data.status', 'partly_received')
        ->assertJsonPath('data.lines.0.open_to_receive', '4.000000')->assertJsonPath('data.lines.1.open_to_receive', '0.000000');

    $second = $this->receive($this->order['id'], [[$this->line1, '4']], '2026-03-22')->assertCreated()->assertJsonPath('data.number', 'GRN-2026-00002')->json('data');
    $this->getJson($this->api("purchase-orders/{$this->order['id']}"))->assertJsonPath('data.status', 'received');
    expect($first['id'])->not->toBe($second['id']);
    $this->getJson($this->api("purchase-orders/{$this->order['id']}/receipts"))->assertOk()->assertJsonCount(2, 'data');
    $this->getJson($this->api('goods-receipts?filter[purchase_order_id]='.$this->order['id'].'&filter[status]=reversed'))->assertOk()->assertJsonCount(0, 'data');
    $this->getJson($this->api('goods-receipts?purchase_order_id='.$this->order['id']))->assertOk()->assertJsonCount(2, 'data');
    expect($this->journalCount())->toBe(0);
});

it('refuses more than is open, naming the line', function (): void {
    $this->receive($this->order['id'], [[$this->line1, '10.000001']])->assertStatus(422)->assertJsonPath('code', 'receipt_quantity_exceeds_open')
        ->assertJsonPath('violations.0.line_no', 1);
    $this->receive($this->order['id'], [[$this->line1, '6'], [$this->line2, '5']])->assertStatus(422)->assertJsonPath('violations.0.line_no', 2);
    $this->getJson($this->api("purchase-orders/{$this->order['id']}"))->assertJsonPath('data.status', 'approved');
});

it('allows an over-receipt within the tolerance setting', function (): void {
    $this->procurementSettings(['receipt_over_tolerance_pct' => '10']);

    $this->receive($this->order['id'], [[$this->line1, '11']])->assertCreated();
    $this->receive($this->order['id'], [[$this->line1, '0.1']])->assertStatus(422);
    $this->getJson($this->api("purchase-orders/{$this->order['id']}"))->assertJsonPath('data.lines.0.open_to_receive', '0.000000');
});

it('refuses a line of another order and a zero quantity', function (): void {
    $other = $this->approvedOrder();

    $this->receive($this->order['id'], [[$other['lines'][0]['id'], '1']])->assertStatus(422)->assertJsonPath('code', 'receipt_line_invalid');
    $this->receive($this->order['id'], [[$this->line1, '0']])->assertStatus(422);
    $this->receive($this->order['id'], [])->assertStatus(422);
});

it('answers 409 to a stale order version', function (): void {
    $this->receive($this->order['id'], [[$this->line1, '1']])->assertCreated();

    $this->receive($this->order['id'], [[$this->line1, '1']], extra: ['order_version' => $this->order['version']])->assertStatus(409)->assertJsonPath('code', 'version_conflict');
});

it('reverses a receipt, restoring the status and the open quantity, and keeps the row', function (): void {
    $receipt = $this->receive($this->order['id'], [[$this->line1, '10'], [$this->line2, '4']])->assertCreated()->json('data');
    $this->getJson($this->api("purchase-orders/{$this->order['id']}"))->assertJsonPath('data.status', 'received');

    $this->asPerson($this->accountant)->postJson($this->api("goods-receipts/{$receipt['id']}/reverse"), ['reason' => 'Wrong delivery'], $this->key())->assertForbidden();
    $this->asPerson($this->owner)->postJson($this->api("goods-receipts/{$receipt['id']}/reverse"), ['reason' => 'Wrong delivery'], $this->key())->assertOk()
        ->assertJsonPath('data.status', 'reversed')->assertJsonPath('data.reversal_reason', 'Wrong delivery')->assertJsonPath('data.reversed_by', $this->owner->id)
        ->assertJsonPath('data.can.reverse', false)->assertJsonCount(2, 'data.lines');

    $this->getJson($this->api("purchase-orders/{$this->order['id']}"))->assertJsonPath('data.status', 'approved')->assertJsonPath('data.lines.0.open_to_receive', '10.000000');
    $this->getJson($this->api("goods-receipts/{$receipt['id']}"))->assertOk()->assertJsonPath('data.status', 'reversed');
    $this->receive($this->order['id'], [[$this->line1, '10']])->assertCreated()->assertJsonPath('data.number', 'GRN-2026-00002');
});

it('refuses to reverse twice, and to reverse without a reason', function (): void {
    $receipt = $this->receive($this->order['id'], [[$this->line1, '1']])->assertCreated()->json('data');

    $this->asPerson($this->owner)->postJson($this->api("goods-receipts/{$receipt['id']}/reverse"), [], $this->key())->assertStatus(422);
    $this->postJson($this->api("goods-receipts/{$receipt['id']}/reverse"), ['reason' => '   '], $this->key())->assertStatus(422);
    $this->postJson($this->api("goods-receipts/{$receipt['id']}/reverse"), ['reason' => 'Mistake'], $this->key())->assertOk();
    $this->postJson($this->api("goods-receipts/{$receipt['id']}/reverse"), ['reason' => 'Mistake'], $this->key())->assertForbidden();
});

it('refuses to reverse a billed receipt until the bill is voided', function (): void {
    $this->workflow('bill');
    $receipt = $this->receive($this->order['id'], [[$this->line1, '10']])->assertCreated()->json('data');
    $bill = $this->asPerson($this->accountant)->postJson($this->api("goods-receipts/{$receipt['id']}/bill"), ['issue_date' => '2026-03-25'], $this->key())->assertCreated()->json('data');
    $this->submitBill($bill['id'])->assertOk()->assertJsonPath('data.status', 'pending_approval');

    $this->asPerson($this->owner)->postJson($this->api("goods-receipts/{$receipt['id']}/reverse"), ['reason' => 'Mistake'], $this->key())->assertStatus(422)->assertJsonPath('code', 'receipt_already_billed');

    $this->asPerson($this->accountant)->postJson($this->api("bills/{$bill['id']}/void"), ['reason' => 'Wrong bill'], $this->key())->assertOk();
    $this->asPerson($this->owner)->postJson($this->api("goods-receipts/{$receipt['id']}/reverse"), ['reason' => 'Mistake'], $this->key())->assertOk();
});

it('refuses to reverse a receipt billed on a posted bill until that bill is reversed', function (): void {
    $receipt = $this->receive($this->order['id'], [[$this->line1, '10']])->assertCreated()->json('data');
    $bill = $this->asPerson($this->accountant)->postJson($this->api("goods-receipts/{$receipt['id']}/bill"), ['issue_date' => '2026-03-25'], $this->key())->assertCreated()->json('data');
    $posted = $this->submitBill($bill['id'])->assertOk()->assertJsonPath('data.status', 'posted')->json('data');

    $this->asPerson($this->owner)->postJson($this->api("goods-receipts/{$receipt['id']}/reverse"), ['reason' => 'Mistake'], $this->key())->assertStatus(422)->assertJsonPath('code', 'receipt_already_billed');

    $this->asPerson($this->owner, signing: true)->postJson($this->api("bills/{$posted['id']}/reverse"), [], $this->key())->assertOk()->assertJsonPath('data.status', 'reversed');
    $this->asPerson($this->owner)->postJson($this->api("goods-receipts/{$receipt['id']}/reverse"), ['reason' => 'Mistake'], $this->key())->assertOk();
});

it('has no routes to edit or delete a receipt', function (): void {
    $receipt = $this->receive($this->order['id'], [[$this->line1, '1']])->assertCreated()->json('data');

    $this->asPerson($this->owner)->putJson($this->api("goods-receipts/{$receipt['id']}"), [], $this->key())->assertStatus(405);
    $this->deleteJson($this->api("goods-receipts/{$receipt['id']}"), [], $this->key())->assertStatus(405);
});

it('writes no journal for receipts or their reversal', function (): void {
    $receipt = $this->receive($this->order['id'], [[$this->line1, '3']])->assertCreated()->json('data');
    $this->asPerson($this->owner)->postJson($this->api("goods-receipts/{$receipt['id']}/reverse"), ['reason' => 'Mistake'], $this->key())->assertOk();

    expect($this->journalCount())->toBe(0);
});
