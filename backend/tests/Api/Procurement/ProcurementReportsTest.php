<?php

declare(strict_types=1);

/*
 * The three procurement reports (D14): open commitments, orders awaiting receipt, and received-not-billed as of a date.
 * Every money figure is {amount, currency}, every quantity a string, and each report carries meta.total_base.
 */

beforeEach(function (): void {
    $this->setUpTrade();
});

it('reports open commitments by supplier and account in document and base currency, which drop with billing and vanish on close', function (): void {
    $this->inTenant(fn () => $this->t->rate('EUR', '2026-03-12', '1.10'));
    $eur = $this->inTenant(fn () => $this->t->contact('S3', 'supplier', 'EUR'));
    $usd = $this->approvedOrder($this->orderBody(lines: [[10000, '10', 'VAT10']]));
    $foreign = $this->approvedOrder($this->orderBody($eur, [[5000, '4']]));

    $report = $this->asPerson($this->accountant)->getJson($this->api('procurement/open-commitments'))->assertOk()
        ->assertJsonCount(2, 'data')->assertJsonPath('meta.total_base', ['amount' => 122000, 'currency' => 'USD'])->json();
    expect($report['data'][0])->toMatchArray(['contact_name' => 'Contact S1', 'account_code' => '5000', 'currency' => 'USD'])
        ->and($report['data'][0]['open_fc'])->toBe(['amount' => 100000, 'currency' => 'USD'])
        ->and($report['data'][0]['open_base'])->toBe(['amount' => 100000, 'currency' => 'USD'])
        ->and($report['data'][1]['contact_name'])->toBe('Contact S3')
        ->and($report['data'][1]['open_fc'])->toBe(['amount' => 20000, 'currency' => 'EUR'])
        ->and($report['data'][1]['open_base'])->toBe(['amount' => 22000, 'currency' => 'USD']);

    $this->getJson($this->api('procurement/open-commitments?contact_id='.$eur))->assertJsonCount(1, 'data')->assertJsonPath('meta.total_base.amount', 22000);

    $this->receive($usd['id'], [[$usd['lines'][0]['id'], '4']])->assertCreated();
    $this->submitBill($this->billOf($usd['id'])['id'])->assertOk();
    $this->getJson($this->api('procurement/open-commitments'))->assertJsonPath('data.0.open_fc.amount', 60000)->assertJsonPath('meta.total_base.amount', 82000);

    $this->asPerson($this->owner)->postJson($this->api("purchase-orders/{$foreign['id']}/close"), [], $this->key())->assertOk();
    $this->getJson($this->api('procurement/open-commitments'))->assertJsonCount(1, 'data')->assertJsonPath('meta.total_base.amount', 60000);
});

it('lists the order lines awaiting receipt, soonest expected first', function (): void {
    $late = $this->approvedOrder($this->orderBody(lines: [[10000, '10'], [500, '4']], extra: ['expected_date' => '2026-05-01']));
    $soon = $this->approvedOrder($this->orderBody(lines: [[2000, '3']], extra: ['expected_date' => '2026-04-01']));
    $this->receive($late['id'], [[$late['lines'][0]['id'], '6']])->assertCreated();

    $report = $this->asPerson($this->accountant)->getJson($this->api('procurement/awaiting-receipt'))->assertOk()->assertJsonCount(3, 'data')->json();
    expect($report['data'][0])->toMatchArray(['number' => 'PO-2026-00002', 'purchase_order_id' => $soon['id'], 'ordered' => '3.000000', 'received' => '0.000000', 'open' => '3.000000', 'expected_date' => '2026-04-01', 'line_no' => 1])
        ->and($report['data'][0]['open_fc'])->toBe(['amount' => 6000, 'currency' => 'USD'])
        ->and($report['data'][1])->toMatchArray(['purchase_order_id' => $late['id'], 'line_no' => 1, 'received' => '6.000000', 'open' => '4.000000'])
        ->and($report['data'][1]['open_fc'])->toBe(['amount' => 40000, 'currency' => 'USD'])
        ->and($report['data'][2])->toMatchArray(['line_no' => 2, 'open' => '4.000000'])
        ->and($report['meta']['total_base'])->toBe(['amount' => 48000, 'currency' => 'USD']);

    $this->getJson($this->api('procurement/awaiting-receipt?contact_id='.$this->t->supplierWht))->assertJsonCount(0, 'data');
});

it('answers received-not-billed as of a date, from what the ledger knew then', function (): void {
    $order = $this->approvedOrder($this->orderBody(lines: [[10000, '10']]));
    $line = $order['lines'][0]['id'];
    $first = $this->receive($order['id'], [[$line, '8']], '2026-03-10')->assertCreated()->json('data');
    $second = $this->receive($order['id'], [[$line, '2']], '2026-03-12')->assertCreated()->json('data');
    $this->asPerson($this->owner)->postJson($this->api("goods-receipts/{$second['id']}/reverse"), ['reason' => 'Returned'], $this->key())->assertOk(); // on 2026-03-15
    $this->receive($order['id'], [[$line, '2']], '2026-04-10')->assertCreated();

    $unbilled = fn (string $asOf): string => $this->asPerson($this->viewerUser())->getJson($this->api("procurement/received-not-billed?as_of={$asOf}"))->assertOk()
        ->assertJsonPath('meta.as_of', $asOf)->json('data.0.unbilled') ?? '0';

    // 14 March: the second receipt was dated before and not yet reversed, so it counts; the one dated in April does not.
    expect($unbilled('2026-03-14'))->toBe('10.000000');
    $this->getJson($this->api('procurement/received-not-billed?as_of=2026-03-14'))->assertJsonPath('data.0.unbilled_fc', ['amount' => 100000, 'currency' => 'USD'])
        ->assertJsonPath('meta.total_base', ['amount' => 100000, 'currency' => 'USD']);
    // 31 March: reversed on the 15th, so only the first.
    expect($unbilled('2026-03-31'))->toBe('8.000000');

    // A bill waiting for approval does not reduce it; a posted one does.
    $this->workflow('bill');
    $draft = $this->asPerson($this->accountant)->postJson($this->api("goods-receipts/{$first['id']}/bill"), ['issue_date' => '2026-03-25'], $this->key())->assertCreated()->json('data');
    $this->putJson($this->api("bills/{$draft['id']}"), procPutReceiptBill($draft, '5'), $this->key())->assertOk();
    $this->submitBill($draft['id'])->assertOk()->assertJsonPath('data.status', 'pending_approval');
    expect($unbilled('2026-03-31'))->toBe('8.000000');

    $posted = $this->asPerson($this->approver, signing: true)->postJson($this->api("bills/{$draft['id']}/approve"), [], $this->key())->assertOk()->assertJsonPath('data.status', 'posted')->json('data');
    expect($unbilled('2026-03-31'))->toBe('3.000000')->and($unbilled('2026-03-20'))->toBe('8.000000');
    $this->getJson($this->api('procurement/received-not-billed?as_of=2026-03-31'))->assertJsonPath('data.0.unbilled_base.amount', 30000)->assertJsonPath('data.0.order_line_id', $line);

    // Reversed in April: still counts as billed on 31 March, no longer on 30 April.
    $this->asPerson($this->owner, signing: true)->postJson($this->api("bills/{$posted['id']}/reverse"), ['date' => '2026-04-20'], $this->key())->assertOk()->assertJsonPath('data.status', 'reversed');
    expect($unbilled('2026-03-31'))->toBe('3.000000')->and($unbilled('2026-04-30'))->toBe('10.000000');
});

it('lets a viewer read the reports and keeps them from a sales assistant', function (): void {
    $this->approvedOrder();

    foreach (['open-commitments', 'awaiting-receipt', 'received-not-billed'] as $report) {
        $this->asPerson($this->viewerUser())->getJson($this->api("procurement/{$report}"))->assertOk();
        $this->asPerson($this->assistant)->getJson($this->api("procurement/{$report}"))->assertForbidden();
    }
    $this->asPerson($this->viewerUser())->getJson($this->api('procurement/received-not-billed?as_of=15-03-2026'))->assertStatus(422);
});

function procPutReceiptBill(array $bill, string $quantity): array
{
    return [
        'contact_id' => $bill['contact_id'], 'issue_date' => $bill['issue_date'], 'due_date' => $bill['due_date'], 'reference' => $bill['reference'], 'version' => $bill['version'],
        'lines' => array_map(fn (array $l): array => [
            'description' => $l['description'], 'account_id' => $l['account_id'], 'quantity' => $quantity, 'unit_price_fc' => $l['unit_price_fc']['amount'],
            'tax_code_id' => $l['tax_code_id'], 'purchase_order_line_id' => $l['purchase_order_line_id'], 'goods_receipt_line_id' => $l['goods_receipt_line_id'],
        ], $bill['lines']),
    ];
}
