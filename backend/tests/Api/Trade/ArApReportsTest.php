<?php

declare(strict_types=1);

use Illuminate\Support\Facades\DB;

/*
 * AR and AP aging, customer and supplier statements, tax return (plan 2.15). Invoices here have no VAT unless said, so the
 * total is the price in cents. Aging as of 2026-06-30.
 */

beforeEach(function (): void {
    $this->setUpTrade();
    $this->rpt = fn (string $path): array => $this->asPerson($this->owner)->getJson($this->api("reports/{$path}"))->assertOk()->json('data');
});

/** Net AR (debit - credit) or AP (credit - debit) control balance of all contacts up to a date. */
function controlAt(object $test, string $control, string $date): int
{
    return $test->inTenant(fn (): int => (int) DB::table('journal_lines as l')->join('journals as j', 'j.id', '=', 'l.journal_id')->join('accounts as a', 'a.id', '=', 'l.account_id')
        ->where('a.control_type', $control)->where('j.journal_date', '<=', $date)->whereIn('j.status', ['posted', 'reversed'])
        ->sum(DB::raw($control === 'ar' ? 'l.debit - l.credit' : 'l.credit - l.debit')));
}

function amt(array $row, string $key): int
{
    return $row[$key]['amount'];
}

it('buckets by due date: due today is current, 1 day late is 1-30, and 30/31, 60/61, 90/91 split at the boundaries', function (): void {
    // As of 2026-06-30. Due date → days late → price (cents): 06-30 → 0 → 100; 06-29 → 1 → 200; 05-31 → 30 → 300; 05-30 → 31 → 400;
    // 05-01 → 60 → 500; 04-30 → 61 → 600; 04-01 → 90 → 700; 03-31 → 91 → 800.
    foreach ([['2026-06-30', 100], ['2026-06-29', 200], ['2026-05-31', 300], ['2026-05-30', 400], ['2026-05-01', 500], ['2026-04-30', 600], ['2026-04-01', 700], ['2026-03-31', 800]] as [$due, $price]) {
        $this->postedDoc('invoices', $this->t->body($this->t->customer, [[$price, '1']], '2026-03-01', ['due_date' => $due]));
    }
    $d = ($this->rpt)('ar-aging?as_of=2026-06-30');
    $row = $d['rows'][0];

    // current 100; 1-30 = 200 + 300 = 500; 31-60 = 400 + 500 = 900; 61-90 = 600 + 700 = 1,300; 90+ = 800; open 3,600.
    expect($d['rows'])->toHaveCount(1)->and($row['contact']['id'])->toBe($this->t->customer)
        ->and([amt($row, 'current'), amt($row, 'days_1_30'), amt($row, 'days_31_60'), amt($row, 'days_61_90'), amt($row, 'days_over_90'), amt($row, 'open')])
        ->toBe([100, 500, 900, 1300, 800, 3600])
        ->and(amt($d['totals'], 'net'))->toBe(3600)->and($d['totals']['open']['currency'])->toBe('USD')
        ->and(amt($d['totals'], 'open'))->toBe(controlAt($this, 'ar', '2026-06-30'));
});

it('lists credits apart from the buckets and ties open less credits to the control account at every as-of date', function (): void {
    $inv = $this->sale(10000, '2026-03-15');                                               // 11,000, due 04-14
    $this->postedSettlement('receipt', $this->t->customer, 4000, [[$inv['id'], 4000]], '2026-03-20');
    $note = $this->postedDoc('invoices', $this->t->body($this->t->customer, [[1000, '1']], '2026-03-25', ['kind' => 'credit_note', 'related_invoice_id' => $inv['id']]));
    $rct = $this->postedSettlement('receipt', $this->t->customer, 2000, [], '2026-04-01');  // 2,000 on account

    // Before the receipt (03-18): 11,000 open, nothing else.
    $a = ($this->rpt)('ar-aging?as_of=2026-03-18');
    expect(amt($a['totals'], 'open'))->toBe(11000)->and($a['credits'])->toBe([])->and(amt($a['totals'], 'net'))->toBe(11000)
        ->and(amt($a['totals'], 'net'))->toBe(controlAt($this, 'ar', '2026-03-18'));

    // 04-05: open 11,000 - 4,000 = 7,000 (not netted with the credits); credits: note 1,000 + on account 2,000 = 3,000; net 4,000.
    $b = ($this->rpt)('ar-aging?as_of=2026-04-05');
    expect(amt($b['totals'], 'open'))->toBe(7000)->and(amt($b['totals'], 'credit_notes'))->toBe(1000)->and(amt($b['totals'], 'on_account'))->toBe(2000)
        ->and(amt($b['totals'], 'credits'))->toBe(3000)->and(amt($b['totals'], 'net'))->toBe(4000)
        ->and(amt($b['rows'][0], 'net'))->toBe(4000)->and(amt($b['totals'], 'days_1_30'))->toBe(0)->and(amt($b['totals'], 'current'))->toBe(7000)
        ->and(array_column($b['credits'], 'kind'))->toBe(['credit_note', 'receipt'])
        ->and(array_column($b['credits'], 'number'))->toBe([$note['number'], $rct['number']])
        ->and(amt($b['totals'], 'net'))->toBe(controlAt($this, 'ar', '2026-04-05'));

    // Apply the 2,000 on 04-10: at 04-05 the credit still stands; at 04-10 it is gone and the open amount is 5,000.
    $this->asPerson($this->owner, signing: true)->postJson($this->api("settlements/{$rct['id']}/allocate"), ['invoice_id' => $inv['id'], 'amount_fc' => 2000, 'date' => '2026-04-10'], $this->key())->assertCreated();
    $c = ($this->rpt)('ar-aging?as_of=2026-04-10');
    expect(amt($c['totals'], 'open'))->toBe(5000)->and(amt($c['totals'], 'on_account'))->toBe(0)->and(amt($c['totals'], 'net'))->toBe(4000)
        ->and(amt($c['totals'], 'net'))->toBe(controlAt($this, 'ar', '2026-04-10'))
        ->and(amt(($this->rpt)('ar-aging?as_of=2026-04-05')['totals'], 'on_account'))->toBe(2000);
    // 05-01 is past the due date (04-14) by 17 days.
    expect(amt(($this->rpt)('ar-aging?as_of=2026-05-01')['totals'], 'days_1_30'))->toBe(5000);
});

it('ages payables the same way: a payment on account is a credit, and open less credits is the AP control balance', function (): void {
    $bill = $this->postedDoc('bills', $this->t->body($this->t->supplier, [[5000, '1', null, '0', '5000']], '2026-03-10'));   // 5,000, due 04-09
    $this->postedSettlement('payment', $this->t->supplier, 2000, [[$bill['id'], 2000]], '2026-03-20');
    $this->postedSettlement('payment', $this->t->supplier, 700, [], '2026-03-22');                                                // 700 on account

    $d = ($this->rpt)('ap-aging?as_of=2026-04-20');
    // Open 3,000, 11 days late; credits 700; net 2,300 owed.
    expect(amt($d['totals'], 'open'))->toBe(3000)->and(amt($d['totals'], 'days_1_30'))->toBe(3000)->and(amt($d['totals'], 'on_account'))->toBe(700)
        ->and(amt($d['totals'], 'net'))->toBe(2300)->and(amt($d['totals'], 'net'))->toBe(controlAt($this, 'ap', '2026-04-20'));
});

it('statements run from the control account: opening balance, running balance, closing equals the contact control balance', function (): void {
    $inv = $this->sale(10000, '2026-03-15');                                                      // Dr 11,000
    $rec = $this->postedSettlement('receipt', $this->t->customer, 4000, [[$inv['id'], 4000]], '2026-03-20');   // Cr 4,000
    $this->postedDoc('invoices', $this->t->body($this->t->customer, [[1000, '1']], '2026-03-25', ['kind' => 'credit_note', 'related_invoice_id' => $inv['id']])); // Cr 1,000
    $this->postedSettlement('receipt', $this->t->customer, 2000, [], '2026-04-01');                // Cr 2,000

    $s = $this->asPerson($this->owner)->getJson($this->api("reports/customer-statement?contact_id={$this->t->customer}&from=2026-03-16&to=2026-04-30"))->assertOk()->json('data');
    // Opening (before 03-16): 11,000. Then 11,000 - 4,000 = 7,000; - 1,000 = 6,000; - 2,000 = 4,000.
    expect($s['rows'][0]['journal_id'])->toBeString();
    expect(amt($s, 'opening_balance'))->toBe(11000)
        ->and(array_map(fn ($r) => $r['balance']['amount'], $s['rows']))->toBe([7000, 6000, 4000])
        ->and(array_column($s['rows'], 'type'))->toBe(['receipt', 'credit_note', 'receipt'])
        ->and($s['rows'][0]['document']['number'])->toBe($rec['number'])
        ->and(amt($s, 'closing_balance'))->toBe(4000)->and(amt($s['totals'], 'credit'))->toBe(7000)
        ->and(amt($s, 'closing_balance'))->toBe(controlAt($this, 'ar', '2026-04-30'));

    $all = $this->asPerson($this->owner)->getJson($this->api("reports/customer-statement?contact_id={$this->t->customer}&from=2026-03-01&to=2026-04-30"))->assertOk()->json('data');
    expect(amt($all, 'opening_balance'))->toBe(0)->and($all['rows'][0]['type'])->toBe('invoice')->and($all['rows'][0]['document']['number'])->toBe($inv['number'])
        ->and(amt($all['rows'][0], 'debit'))->toBe(11000)->and(amt($all, 'closing_balance'))->toBe(4000);
    $this->asPerson($this->owner)->getJson($this->api('reports/customer-statement?from=2026-03-01&to=2026-04-30'))->assertUnprocessable();
});

it('supplier statement shows what we owe as a positive balance', function (): void {
    $bill = $this->postedDoc('bills', $this->t->body($this->t->supplier, [[5000, '1', null, '0', '5000']], '2026-03-10'));
    $this->postedSettlement('payment', $this->t->supplier, 2000, [[$bill['id'], 2000]], '2026-03-20');
    $s = $this->asPerson($this->owner)->getJson($this->api("reports/supplier-statement?contact_id={$this->t->supplier}&from=2026-03-01&to=2026-03-31"))->assertOk()->json('data');

    // 5,000 owed after the bill; 5,000 - 2,000 = 3,000 after the payment.
    expect(array_map(fn ($r) => $r['balance']['amount'], $s['rows']))->toBe([5000, 3000])->and(array_column($s['rows'], 'type'))->toBe(['bill', 'payment'])
        ->and(amt($s, 'closing_balance'))->toBe(3000)->and(amt($s, 'closing_balance'))->toBe(controlAt($this, 'ap', '2026-03-31'));
});

it('returns tax per code: VAT10 sales less a credit note, purchases, and a reversed invoice netting out', function (): void {
    $this->sale(10000, '2026-03-10');                                                  // net 10,000, VAT 1,000
    $inv = $this->sale(10000, '2026-03-11');
    $this->postedDoc('invoices', $this->t->body($this->t->customer, [[5000, '1', 'VAT10']], '2026-03-12', ['kind' => 'credit_note', 'related_invoice_id' => $inv['id']])); // net 5,000, VAT 500 (subtracts)
    $this->postedDoc('bills', $this->t->body($this->t->supplier, [[2000, '1', 'VAT10', '0', '5000']], '2026-03-13'));     // net 2,000, input VAT 200
    $gone = $this->sale(3000, '2026-03-14');                                           // net 3,000, VAT 300, reversed below
    $this->asPerson($this->owner, signing: true)->postJson($this->api("invoices/{$gone['id']}/reverse"), ['date' => '2026-03-14'], $this->key())->assertOk();

    $r = ($this->rpt)('tax-return?from=2026-03-01&to=2026-03-31');
    // Sales VAT10: net 10,000 + 10,000 - 5,000 = 15,000; tax 1,000 + 1,000 - 500 = 1,500 (the reversed 3,000 / 300 nets to zero).
    expect($r['sales']['rows'])->toHaveCount(1)->and($r['sales']['rows'][0]['tax_code']['code'])->toBe('VAT10')
        ->and(amt($r['sales']['rows'][0], 'net'))->toBe(15000)->and(amt($r['sales']['rows'][0], 'tax'))->toBe(1500)
        ->and(amt($r['purchases']['rows'][0], 'net'))->toBe(2000)->and(amt($r['purchases']['rows'][0], 'tax'))->toBe(200)
        ->and(amt($r, 'net_tax_payable'))->toBe(1300)
        // The ledger tax accounts agree: output VAT credit 1,500, input VAT debit 200 (postings net the reversal out).
        ->and($this->balance('2100'))->toBe(-1500)->and($this->balance('2110'))->toBe(200)
        ->and(amt($r['sales']['totals'], 'tax'))->toBe(-$this->balance('2100'))->and(amt($r['purchases']['totals'], 'tax'))->toBe($this->balance('2110'));
    // An empty period has no rows.
    expect(($this->rpt)('tax-return?from=2026-05-01&to=2026-05-31')['sales']['rows'])->toBe([]);
});

it('exports the new reports and keeps them behind reports.view / reports.export', function (): void {
    $this->sale();
    foreach (['ar-aging?as_of=2026-06-30', 'ap-aging?as_of=2026-06-30', "customer-statement?contact_id={$this->t->customer}&from=2026-03-01&to=2026-03-31", "supplier-statement?contact_id={$this->t->supplier}&from=2026-03-01&to=2026-03-31", 'tax-return?from=2026-03-01&to=2026-03-31'] as $path) {
        [$name, $query] = explode('?', $path);
        $csv = $this->asPerson($this->accountant)->get($this->api("reports/{$name}/export?{$query}&format=csv"))->assertOk();
        expect($csv->streamedContent())->not->toBe('');
    }
    $this->asPerson($this->assistant)->getJson($this->api('reports/ar-aging'))->assertForbidden();
    $this->asToken($this->newToken(['reports:read']))->getJson($this->api('reports/tax-return?from=2026-03-01&to=2026-03-31'))->assertOk();
});
