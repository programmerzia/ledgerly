<?php

declare(strict_types=1);

use Illuminate\Support\Facades\DB;

/*
 * The three-way match at bill submit (13 §10). These guard the ledger: a bill with no order lines posts exactly as it
 * always did, and a bill made from an order posts the same journal as one typed by hand.
 */

beforeEach(function (): void {
    $this->setUpTrade();
    $this->order = $this->approvedOrder($this->orderBody(lines: [[10000, '10', 'VAT10']]));
    $this->line1 = $this->order['lines'][0]['id'];
});

/** Restates a bill draft as a PUT body, keeping the order links, with $change applied to its first line. */
function procPutBill(object $test, array $bill, array $change = [], array $header = []): array
{
    return [
        'contact_id' => $bill['contact_id'], 'issue_date' => $bill['issue_date'], 'due_date' => $bill['due_date'], 'reference' => $bill['reference'], 'version' => $bill['version'],
        'lines' => array_map(fn (array $l): array => [
            'description' => $l['description'], 'account_id' => $l['account_id'], 'quantity' => $l['quantity'], 'unit_price_fc' => $l['unit_price_fc']['amount'],
            'tax_code_id' => $l['tax_code_id'], 'purchase_order_line_id' => $l['purchase_order_line_id'], 'goods_receipt_line_id' => $l['goods_receipt_line_id'],
            ...$change,
        ], $bill['lines']),
        ...$header,
    ];
}

function procMatchRows(object $test): array
{
    return $test->inTenant(fn () => DB::table('bill_match_results')->orderBy('created_at')->get()->all());
}

it('posts a bill with no order lines exactly as before and writes no match result', function (): void {
    $doc = $this->draftDoc('bills', $this->t->body($this->t->supplierWht, [[40000, '1', 'VAT10', null, '5000']]));
    $posted = $this->submitDoc('bills', $doc['id']);

    expect($posted['number'])->toBe('BILL-FY2026-00001')->and($posted['kind'])->toBe('purchase_bill')->and($posted['amount_due']['amount'])->toBe(40000)
        ->and($posted['lines'][0]['purchase_order_line_id'])->toBeNull()->and($posted['lines'][0]['goods_receipt_line_id'])->toBeNull();
    expect($this->t->journalOf($posted['journal_id']))->toBe([
        '2000' => ['debit' => 0, 'credit' => 40000], '2120' => ['debit' => 0, 'credit' => 4000],
        '5000' => ['debit' => 40000, 'credit' => 0], '2110' => ['debit' => 4000, 'credit' => 0],
    ]);
    expect(procMatchRows($this))->toBe([]);
});

it('does not touch a debit note, even with a purchase order required', function (): void {
    $this->procurementSettings(['require_purchase_order' => true]);
    $note = $this->postedDoc('bills', $this->t->body($this->t->supplier, [[3000, '1', null, '0', '5000']], '2026-03-15', ['kind' => 'debit_note']));

    expect($note['status'])->toBe('posted')->and(procMatchRows($this))->toBe([]);
});

it('makes a bill from an order and from a receipt, linking each line and copying price, tax, account and dimensions', function (): void {
    $receipt = $this->receive($this->order['id'], [[$this->line1, '4']])->assertCreated()->json('data');

    $fromOrder = $this->billOf($this->order['id']);
    expect($fromOrder['kind'])->toBe('purchase_bill')->and($fromOrder['status'])->toBe('draft')->and($fromOrder['contact_id'])->toBe($this->t->supplier)
        ->and($fromOrder['reference'])->toBe('PO-2026-00001')
        ->and($fromOrder['lines'][0])->toMatchArray([
            'quantity' => '4.000000', 'purchase_order_line_id' => $this->line1, 'account_id' => $this->f->account('5000'),
            'tax_code_id' => $this->t->tax['VAT10'], 'goods_receipt_line_id' => null,
        ])->and($fromOrder['lines'][0]['unit_price_fc']['amount'])->toBe(10000);

    $fromReceipt = $this->asPerson($this->accountant)->postJson($this->api("goods-receipts/{$receipt['id']}/bill"), ['issue_date' => '2026-03-26'], $this->key())->assertCreated()->json('data');
    expect($fromReceipt['lines'][0]['goods_receipt_line_id'])->toBe($receipt['lines'][0]['id'])->and($fromReceipt['lines'][0]['purchase_order_line_id'])->toBe($this->line1)
        ->and($fromReceipt['issue_date'])->toBe('2026-03-26');

    $this->getJson($this->api("purchase-orders/{$this->order['id']}/bills"))->assertOk()->assertJsonCount(2, 'data');
});

it('posts a bill made from an order with the same journal as a hand-made bill with the same lines', function (): void {
    $this->receive($this->order['id'], [[$this->line1, '10']])->assertCreated();
    $fromOrder = $this->submitBill($this->billOf($this->order['id'], ['issue_date' => '2026-03-25', 'due_date' => '2026-04-30'])['id'])->assertOk()->assertJsonPath('data.status', 'posted')->json('data');

    $hand = $this->t->body($this->t->supplier, [[10000, '10', 'VAT10', null, '5000']], '2026-03-25', ['due_date' => '2026-04-30', 'reference' => 'PO-2026-00001']);
    $hand['lines'][0]['description'] = 'Widget';
    $hand['memo'] = null;
    $byHand = $this->postedDoc('bills', $hand);

    expect($this->t->journalOf($fromOrder['journal_id']))->toBe($this->t->journalOf($byHand['journal_id']))
        ->and($fromOrder['total'])->toBe($byHand['total'])->and($fromOrder['tax_total'])->toBe($byHand['tax_total'])->and($fromOrder['amount_due'])->toBe($byHand['amount_due']);

    $lines = fn (string $journalId): array => $this->inTenant(fn () => DB::table('journal_lines')->where('journal_id', $journalId)->orderBy('line_no')->get()
        ->map(fn (object $l): array => array_map(fn ($v) => is_string($v) ? preg_replace('/BILL-FY\d{4}-\d+/', 'BILL-N', $v) : $v, array_diff_key((array) $l, array_flip(['id', 'journal_id', 'created_at', 'updated_at']))))->all());
    $a = $lines($fromOrder['journal_id']);
    $b = $lines($byHand['journal_id']);
    expect($a)->not->toBe([])->and($a)->toEqual($b);

    $journals = $this->inTenant(fn () => DB::table('journals')->whereIn('id', [$fromOrder['journal_id'], $byHand['journal_id']])->get()->keyBy('id'));
    foreach (['journal_type', 'total_debit', 'total_credit', 'currency', 'fx_rate', 'journal_date', 'status', 'memo'] as $column) {
        $norm = fn (mixed $v): mixed => is_string($v) ? preg_replace('/BILL-FY\d{4}-\d+/', 'BILL-N', $v) : $v;
        expect($norm($journals[$fromOrder['journal_id']]->{$column} ?? null))->toEqual($norm($journals[$byHand['journal_id']]->{$column} ?? null));
    }
});

it('posts a matched bill and records the outcome matched', function (): void {
    $this->receive($this->order['id'], [[$this->line1, '10']])->assertCreated();
    $bill = $this->billOf($this->order['id']);

    $posted = $this->submitBill($bill['id'])->assertOk()->assertJsonPath('data.status', 'posted')->assertJsonPath('data.number', 'BILL-FY2026-00001')->json('data');
    $rows = procMatchRows($this);
    expect($rows)->toHaveCount(1)->and($rows[0]->outcome)->toBe('matched')->and($rows[0]->invoice_id)->toBe($posted['id'])->and($rows[0]->reason)->toBeNull()
        ->and($rows[0]->decided_by)->toBe($this->accountant->id);
    $this->getJson($this->api("purchase-orders/{$this->order['id']}"))->assertJsonPath('data.lines.0.billed', '10.000000')->assertJsonPath('data.lines.0.received_not_billed', '0.000000');
});

it('refuses a price mismatch with the line, posts nothing and consumes no number', function (): void {
    $this->receive($this->order['id'], [[$this->line1, '10']])->assertCreated();
    $bill = $this->billOf($this->order['id']);
    $this->putJson($this->api("bills/{$bill['id']}"), procPutBill($this, $bill, ['unit_price_fc' => 11000]), $this->key())->assertOk()
        ->assertJsonPath('data.lines.0.purchase_order_line_id', $this->line1);
    $journals = $this->journalCount();

    $this->submitBill($bill['id'])->assertStatus(422)->assertJsonPath('code', 'match_price_mismatch')->assertJsonPath('violations.0.line_no', 1)->assertJsonPath('violations.0.code', 'match_price_mismatch');
    expect($this->journalCount())->toBe($journals)->and(procMatchRows($this))->toBe([]);
    $this->getJson($this->api("bills/{$bill['id']}"))->assertJsonPath('data.status', 'draft')->assertJsonPath('data.number', null);

    $fresh = $this->getJson($this->api("bills/{$bill['id']}"))->json('data');
    $this->putJson($this->api("bills/{$bill['id']}"), procPutBill($this, $fresh, ['unit_price_fc' => 10000]), $this->key())->assertOk();
    $this->submitBill($bill['id'])->assertOk()->assertJsonPath('data.number', 'BILL-FY2026-00001');
});

it('refuses a quantity beyond what was received', function (): void {
    $this->receive($this->order['id'], [[$this->line1, '4']])->assertCreated();
    $bill = $this->billOf($this->order['id']);
    $this->putJson($this->api("bills/{$bill['id']}"), procPutBill($this, $bill, ['quantity' => '6']), $this->key())->assertOk();

    $this->submitBill($bill['id'])->assertStatus(422)->assertJsonPath('code', 'match_quantity_exceeds_received')->assertJsonPath('violations.0.line_no', 1);
});

it('lets an owner override a mismatch with a reason, writing the result and an audit event', function (): void {
    $this->receive($this->order['id'], [[$this->line1, '10']])->assertCreated();
    $bill = $this->billOf($this->order['id']);
    $this->putJson($this->api("bills/{$bill['id']}"), procPutBill($this, $bill, ['unit_price_fc' => 11000]), $this->key())->assertOk();

    $this->submitBill($bill['id'], 'Supplier surcharge agreed by phone', $this->owner)->assertOk()->assertJsonPath('data.status', 'posted');

    $rows = procMatchRows($this);
    expect($rows)->toHaveCount(1)->and($rows[0]->outcome)->toBe('overridden')->and($rows[0]->reason)->toBe('Supplier surcharge agreed by phone')
        ->and($rows[0]->decided_by)->toBe($this->owner->id)->and(json_decode((string) $rows[0]->violations, true)[0]['code'])->toBe('match_price_mismatch');
    $event = $this->inTenant(fn () => DB::table('audit_events')->where('action', 'bill.match_overridden')->first());
    expect($event)->not->toBeNull()->and($event->subject_id)->toBe($bill['id'])->and(json_decode((string) $event->context, true)['reason'])->toBe('Supplier surcharge agreed by phone');
});

it('does not let an accountant, a blank reason or a token override', function (): void {
    $this->receive($this->order['id'], [[$this->line1, '10']])->assertCreated();
    $bill = $this->billOf($this->order['id']);
    $this->putJson($this->api("bills/{$bill['id']}"), procPutBill($this, $bill, ['unit_price_fc' => 11000]), $this->key())->assertOk();

    $this->submitBill($bill['id'], 'Please', $this->accountant)->assertStatus(403)->assertJsonPath('code', 'match_override_forbidden');
    $this->submitBill($bill['id'], '   ', $this->owner)->assertStatus(422)->assertJsonPath('code', 'match_price_mismatch');

    $token = $this->newToken(['bills:read', 'bills:write', 'bills:submit']);
    $this->asToken($token)->postJson($this->api("bills/{$bill['id']}/submit"), ['match_override_reason' => 'Trust me'], $this->key())->assertStatus(403)->assertJsonPath('code', 'match_override_forbidden');
    expect(procMatchRows($this))->toBe([]);
});

it('refuses a supplier or currency mismatch at draft time and a closed order at submit, whatever the reason', function (): void {
    $body = $this->t->body($this->t->supplierWht, [[10000, '1', 'VAT10', null, '5000']]);
    $body['lines'][0]['purchase_order_line_id'] = $this->line1;
    $this->asPerson($this->accountant)->postJson($this->api('bills'), $body, $this->key())->assertStatus(422)->assertJsonPath('code', 'bill_order_supplier_mismatch');

    $this->inTenant(fn () => $this->t->rate('EUR', '2026-03-15', '1.10'));
    $body = $this->t->body($this->t->supplier, [[10000, '1', 'VAT10', null, '5000']], extra: ['currency' => 'EUR']);
    $body['lines'][0]['purchase_order_line_id'] = $this->line1;
    $this->postJson($this->api('bills'), $body, $this->key())->assertStatus(422)->assertJsonPath('code', 'bill_order_currency_mismatch');

    $bill = $this->billOf($this->order['id']);
    $this->asPerson($this->owner)->postJson($this->api("purchase-orders/{$this->order['id']}/close"), [], $this->key())->assertOk();
    $this->submitBill($bill['id'], 'Close enough', $this->owner)->assertStatus(422)->assertJsonPath('code', 'bill_order_not_open');
    expect(procMatchRows($this))->toBe([]);
});

it('lets a small difference pass within the tolerances from settings', function (): void {
    $this->procurementSettings(['po_price_tolerance_pct' => '5', 'po_quantity_tolerance_pct' => '10']);
    $this->receive($this->order['id'], [[$this->line1, '10']])->assertCreated();
    $bill = $this->billOf($this->order['id']);
    $this->putJson($this->api("bills/{$bill['id']}"), procPutBill($this, $bill, ['unit_price_fc' => 10400, 'quantity' => '10.5']), $this->key())->assertOk();

    $this->submitBill($bill['id'])->assertOk()->assertJsonPath('data.status', 'posted');
    expect(procMatchRows($this)[0]->outcome)->toBe('matched');
});

it('requires a purchase order per line when the company says so, and behaves as before once it is off', function (): void {
    $this->procurementSettings(['require_purchase_order' => true]);
    $loose = $this->draftDoc('bills', $this->t->body($this->t->supplier, [[5000, '1', null, '0', '5000'], [3000, '1', null, '0', '5000']]));

    $this->submitBill($loose['id'])->assertStatus(422)->assertJsonPath('code', 'purchase_order_required')
        ->assertJsonPath('violations.0.line_no', 1)->assertJsonPath('violations.1.line_no', 2);

    $this->receive($this->order['id'], [[$this->line1, '10']])->assertCreated();
    $mixed = $this->billOf($this->order['id']);
    $this->putJson($this->api("bills/{$mixed['id']}"), [...procPutBill($this, $mixed), 'lines' => [...procPutBill($this, $mixed)['lines'], ['description' => 'Freight', 'account_id' => $this->f->account('5000'), 'quantity' => '1', 'unit_price_fc' => 2000]]], $this->key())->assertOk();
    $this->submitBill($mixed['id'])->assertStatus(422)->assertJsonPath('code', 'purchase_order_required')->assertJsonPath('violations.0.line_no', 2)->assertJsonCount(1, 'violations');

    $this->submitBill($mixed['id'], 'Freight has no order', $this->owner)->assertOk()->assertJsonPath('data.status', 'posted');
    expect(procMatchRows($this)[0]->outcome)->toBe('overridden');

    $this->procurementSettings(['require_purchase_order' => false]);
    $this->submitBill($loose['id'])->assertOk()->assertJsonPath('data.status', 'posted');
    expect(procMatchRows($this))->toHaveCount(1);
});

it('does not let two bills claim one receipt, and frees it when the first is voided', function (): void {
    $this->workflow('bill');
    $receipt = $this->receive($this->order['id'], [[$this->line1, '10']])->assertCreated()->json('data');
    $bill = fn () => $this->asPerson($this->accountant)->postJson($this->api("goods-receipts/{$receipt['id']}/bill"), ['issue_date' => '2026-03-25'], $this->key())->assertCreated()->json('data');
    $first = $bill();
    $second = $bill();

    $this->submitBill($first['id'])->assertOk()->assertJsonPath('data.status', 'pending_approval');
    $this->submitBill($second['id'])->assertStatus(422)->assertJsonPath('code', 'match_quantity_exceeds_received');

    $this->asPerson($this->accountant)->postJson($this->api("bills/{$first['id']}/void"), ['reason' => 'Duplicate'], $this->key())->assertOk();
    $this->submitBill($second['id'])->assertOk()->assertJsonPath('data.status', 'pending_approval');
    $this->getJson($this->api("purchase-orders/{$this->order['id']}"))->assertJsonPath('data.lines.0.billed', '10.000000');
});

it('keeps the order link on a PUT that sends it and drops it on a PUT that does not', function (): void {
    $this->receive($this->order['id'], [[$this->line1, '10']])->assertCreated();
    $bill = $this->billOf($this->order['id']);

    $kept = $this->putJson($this->api("bills/{$bill['id']}"), procPutBill($this, $bill), $this->key())->assertOk()->json('data');
    expect($kept['lines'][0]['purchase_order_line_id'])->toBe($this->line1);

    $body = procPutBill($this, $kept);
    unset($body['lines'][0]['purchase_order_line_id'], $body['lines'][0]['goods_receipt_line_id']);
    $body['version'] = $kept['version'];
    $dropped = $this->putJson($this->api("bills/{$bill['id']}"), $body, $this->key())->assertOk()->json('data');
    expect($dropped['lines'][0]['purchase_order_line_id'])->toBeNull();
});

it('shows how a bill stands against its order without writing anything', function (): void {
    $this->receive($this->order['id'], [[$this->line1, '4']])->assertCreated();
    $bill = $this->billOf($this->order['id']);
    $this->putJson($this->api("bills/{$bill['id']}"), procPutBill($this, $bill, ['quantity' => '6', 'unit_price_fc' => 11000]), $this->key())->assertOk();

    $match = $this->getJson($this->api("bills/{$bill['id']}/match"))->assertOk()->assertJsonPath('data.applies', true)
        ->assertJsonPath('data.lines.0.line_no', 1)->assertJsonPath('data.lines.0.order_price_fc.amount', 10000)->assertJsonPath('data.lines.0.received', '4.000000')
        ->assertJsonPath('data.last_result', null)->json('data');
    expect(array_column($match['mismatches'], 'code'))->toContain('match_price_mismatch', 'match_quantity_exceeds_received')
        ->and(procMatchRows($this))->toBe([]);
});

it('still needs a second person to approve an overridden bill when a workflow applies', function (): void {
    $this->workflow('bill');
    $this->receive($this->order['id'], [[$this->line1, '10']])->assertCreated();
    $bill = $this->billOf($this->order['id']);
    $this->putJson($this->api("bills/{$bill['id']}"), procPutBill($this, $bill, ['unit_price_fc' => 11000]), $this->key())->assertOk();

    $this->submitBill($bill['id'], 'Agreed surcharge', $this->owner)->assertOk()->assertJsonPath('data.status', 'pending_approval');
    expect(procMatchRows($this)[0]->outcome)->toBe('overridden');

    $this->asPerson($this->owner, signing: true)->postJson($this->api("bills/{$bill['id']}/approve"), [], $this->key())->assertForbidden();
    $this->asPerson($this->approver, signing: true)->postJson($this->api("bills/{$bill['id']}/approve"), [], $this->key())->assertOk()->assertJsonPath('data.status', 'posted');
    expect(procMatchRows($this))->toHaveCount(1);
});
