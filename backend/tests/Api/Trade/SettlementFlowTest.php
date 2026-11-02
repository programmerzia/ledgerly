<?php

declare(strict_types=1);

use App\Actions\Organisation\AssignCompanyRole;
use App\Actions\Organisation\Inputs\CompanyRoleInput;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\LedgerChecks;

/*
 * Receipts, payments, refunds and credit (plan 2.12). Every figure is worked out by hand in the comments: invoice 10,000 plus
 * 10% VAT is 11,000 (cents), all in USD unless a rate is named.
 */

beforeEach(function (): void {
    $this->setUpTrade();
});

it('settles an invoice in full with a receipt: Dr bank 11,000, Cr AR 11,000, invoice paid', function (): void {
    $inv = $this->sale();
    $r = $this->postedSettlement('receipt', $this->t->customer, 11000, [[$inv['id'], 11000]]);

    expect($r['status'])->toBe('posted')->and($r['number'])->toBe('RCT-FY2026-00001')->and($r['unallocated_fc']['amount'])->toBe(0)
        ->and($r['allocations'][0]['amount']['amount'])->toBe(11000)->and($r['allocations'][0]['fx_gain_loss']['amount'])->toBe(0)
        ->and($this->t->journalOf($r['journal_id']))->toBe(['1000' => ['debit' => 11000, 'credit' => 0], '1100' => ['debit' => 0, 'credit' => 11000]]);
    $after = $this->document('invoices', $inv['id']);
    expect($after['settled']['amount'])->toBe(11000)->and($after['amount_due']['amount'])->toBe(0)->and($after['payment_status'])->toBe('paid')
        ->and($this->balance('1100'))->toBe(0);
    $this->inTenant(fn () => expect(LedgerChecks::problems())->toBe([]));
});

it('settles in two parts: 4,000 then 7,000 leaves 7,000 open between them', function (): void {
    $inv = $this->sale();
    $this->postedSettlement('receipt', $this->t->customer, 4000, [[$inv['id'], 4000]]);
    $mid = $this->document('invoices', $inv['id']);
    expect($mid['amount_due']['amount'])->toBe(7000)->and($mid['payment_status'])->toBe('partially_paid')->and($this->balance('1100'))->toBe(7000);

    $this->postedSettlement('receipt', $this->t->customer, 7000, [[$inv['id'], 7000]]);
    expect($this->document('invoices', $inv['id'])['payment_status'])->toBe('paid')->and($this->balance('1100'))->toBe(0);
});

it('books realised FX by cash direction: receipts and payments, gains and losses', function (string $kind, string $rate, int $cashBase, string $fxSide, int $fxAmount): void {
    $this->t->rate('EUR', '2026-03-01', '1.10');
    $sales = $kind === 'receipt';
    // EUR 10,000 at 1.10 is 11,000 carried on AR (or AP).
    $doc = $sales
        ? $this->postedDoc('invoices', $this->t->body($this->t->customer, [[10000, '1', null, '0', '4010']], '2026-03-01', ['currency' => 'EUR', 'fx_rate' => '1.10']))
        : $this->postedDoc('bills', $this->t->body($this->t->supplier, [[10000, '1', null, '0', '5010']], '2026-03-01', ['currency' => 'EUR', 'fx_rate' => '1.10']));
    expect($doc['total']['amount'])->toBe(11000);

    $s = $this->postedSettlement($kind, $sales ? $this->t->customer : $this->t->supplier, 10000, [[$doc['id'], 10000]], '2026-03-20', '1200', ['currency' => 'EUR', 'fx_rate' => $rate]);
    $journal = $this->t->journalOf($s['journal_id']);
    $control = $sales ? '1100' : '2000';
    $cash = $journal['1200'];
    expect($s['amount']['amount'])->toBe($cashBase)
        ->and($sales ? $cash['debit'] : $cash['credit'])->toBe($cashBase)
        ->and($sales ? $journal[$control]['credit'] : $journal[$control]['debit'])->toBe(11000)
        ->and($journal['7100'][$fxSide])->toBe($fxAmount)
        ->and($s['allocations'][0]['fx_gain_loss']['amount'])->toBe(($fxSide === 'credit' ? 1 : -1) * $fxAmount)
        ->and($this->balance($control))->toBe(0);
    $this->inTenant(fn () => expect(LedgerChecks::problems())->toBe([]));
})->with([
    // receipt at 1.20 = 12,000 in, carried 11,000: gain 1,000 (Cr)    receipt at 1.05 = 10,500 in: loss 500 (Dr)
    'receipt gain' => ['receipt', '1.20', 12000, 'credit', 1000],
    'receipt loss' => ['receipt', '1.05', 10500, 'debit', 500],
    // payment at 1.20 = 12,000 out, carried 11,000: loss 1,000 (Dr)   payment at 1.05 = 10,500 out: gain 500 (Cr)
    'payment loss' => ['payment', '1.20', 12000, 'debit', 1000],
    'payment gain' => ['payment', '1.05', 10500, 'credit', 500],
]);

it('books a realised loss to its own account when the company has one, a gain to the gain account', function (): void {
    $this->inTenant(function (): void {
        $row = DB::table('company_settings')->where('company_id', $this->f->companyId);
        $accounts = json_decode((string) $row->value('posting_accounts'), true);
        $row->update(['posting_accounts' => json_encode([...$accounts, 'fx_realised_loss' => $this->f->account('5010')])]);
    });
    $this->t->rate('EUR', '2026-03-01', '1.10');
    $invoice = fn () => $this->postedDoc('invoices', $this->t->body($this->t->customer, [[10000, '1', null, '0', '4010']], '2026-03-01', ['currency' => 'EUR', 'fx_rate' => '1.10']));

    $loss = $this->postedSettlement('receipt', $this->t->customer, 10000, [[$invoice()['id'], 10000]], '2026-03-20', '1200', ['currency' => 'EUR', 'fx_rate' => '1.05']);
    expect($this->t->journalOf($loss['journal_id']))->toHaveKey('5010')->not->toHaveKey('7100');
    expect($this->t->journalOf($loss['journal_id'])['5010']['debit'])->toBe(500);

    $gain = $this->postedSettlement('receipt', $this->t->customer, 10000, [[$invoice()['id'], 10000]], '2026-03-21', '1200', ['currency' => 'EUR', 'fx_rate' => '1.20']);
    expect($this->t->journalOf($gain['journal_id'])['7100']['credit'])->toBe(1000);
    $this->inTenant(fn () => expect(LedgerChecks::problems())->toBe([]));
});

it('lists what was applied to a document, with credits undoable and reversed ones gone', function (): void {
    $invoice = $this->postedDoc('invoices', $this->t->body($this->t->customer, [[10000, '1', 'VAT10']], '2026-03-01'));
    $note = $this->postedDoc('invoices', $this->t->body($this->t->customer, [[1000, '1', 'VAT10']], '2026-03-02', ['kind' => 'credit_note', 'related_invoice_id' => $invoice['id']]));
    $receipt = $this->postedSettlement('receipt', $this->t->customer, 2000, [[$invoice['id'], 2000]], '2026-03-03');
    $credit = $this->asPerson($this->owner, signing: true)->postJson($this->api("invoices/{$note['id']}/allocate"), ['invoice_id' => $invoice['id'], 'amount_fc' => 500], $this->key())->assertCreated();

    $rows = $this->getJson($this->api("invoices/{$invoice['id']}/payments"))->assertOk()->json('data');
    $byType = collect($rows)->keyBy('type');
    expect($rows)->toHaveCount(2)
        ->and($byType['settlement']['id'])->toBe($receipt['id'])->and($byType['settlement']['amount_fc']['amount'])->toBe(2000)->and($byType['settlement']['can']['undo'])->toBeFalse()
        ->and($byType['credit_application']['id'])->toBe($credit->json('data.id'))->and($byType['credit_application']['number'])->toBe($note['number'])->and($byType['credit_application']['can']['undo'])->toBeTrue();
    expect($this->getJson($this->api("invoices/{$note['id']}/payments"))->assertOk()->json('data.0.number'))->toBe($invoice['number']);

    $this->postJson($this->api('credit-applications/'.$credit->json('data.id').'/undo'), [], $this->key())->assertOk();
    $this->getJson($this->api("invoices/{$invoice['id']}/payments"))->assertJsonCount(1, 'data');
});

it('lets the allocation that clears the invoice take its remaining base, so no cent stays on AR', function (): void {
    // EUR 100.00 at 1.005 is 100.5 → 101 (HALF_UP). Two receipts of EUR 50 at the same rate each carry round(50.25) = 50, so the
    // first leaves 51 on AR; the second clears the invoice with its remaining base 51 and books 50 − 51 = a loss of 1.
    $this->t->rate('EUR', '2026-03-01', '1.005');
    $inv = $this->postedDoc('invoices', $this->t->body($this->t->customer, [[10000, '1', null, '0', '4010']], '2026-03-01', ['currency' => 'EUR', 'fx_rate' => '1.005']));
    expect($inv['total']['amount'])->toBe(10050);

    $first = $this->postedSettlement('receipt', $this->t->customer, 5000, [[$inv['id'], 5000]], '2026-03-20', '1200', ['currency' => 'EUR', 'fx_rate' => '1.005']);
    $second = $this->postedSettlement('receipt', $this->t->customer, 5000, [[$inv['id'], 5000]], '2026-03-21', '1200', ['currency' => 'EUR', 'fx_rate' => '1.005']);
    // 5000 × 1.005 = 5025 each: carried 5025 then the remaining 10050 − 5025 = 5025, so no difference at all here.
    expect($first['allocations'][0]['amount']['amount'])->toBe(5025)->and($second['allocations'][0]['amount']['amount'])->toBe(5025)->and($this->balance('1100'))->toBe(0);
    $this->inTenant(fn () => expect(LedgerChecks::problems())->toBe([]));
});

it('clears an odd cent on the last allocation (three parts of EUR 1.00 at 1.5 → 150)', function (): void {
    // EUR 1.00 at 1.505 = 1.505 → 151 (HALF_UP of 150.5). Parts of 33, 33, 34 cents: carried round(49.665)=50, round(49.665)=50, then the remaining 151 − 100 = 51.
    $this->t->rate('EUR', '2026-03-01', '1.505');
    $inv = $this->postedDoc('invoices', $this->t->body($this->t->customer, [[100, '1', null, '0', '4010']], '2026-03-01', ['currency' => 'EUR', 'fx_rate' => '1.505']));
    expect($inv['total']['amount'])->toBe(151);
    $carried = [];
    foreach ([33, 33, 34] as $part) {
        $s = $this->postedSettlement('receipt', $this->t->customer, $part, [[$inv['id'], $part]], '2026-03-20', '1200', ['currency' => 'EUR', 'fx_rate' => '1.505']);
        $carried[] = $s['allocations'][0]['amount']['amount'];
    }
    expect($carried)->toBe([50, 50, 51])->and($this->balance('1100'))->toBe(0)->and($this->document('invoices', $inv['id'])['settled']['amount'])->toBe(151);
});

it('keeps an overpayment on account, then applies it to another invoice', function (): void {
    $a = $this->sale();               // 11,000
    $b = $this->sale(5000);          // 5,500
    $r = $this->postedSettlement('receipt', $this->t->customer, 12000, [[$a['id'], 11000]]);
    expect($r['unallocated_fc']['amount'])->toBe(1000)->and($r['unallocated']['amount'])->toBe(1000)
        ->and($this->t->journalOf($r['journal_id']))->toBe(['1000' => ['debit' => 12000, 'credit' => 0], '1100' => ['debit' => 0, 'credit' => 12000]])
        ->and($this->balance('1100'))->toBe(5500 - 1000);

    $this->asPerson($this->owner, signing: true)->postJson($this->api("settlements/{$r['id']}/allocate"), ['invoice_id' => $b['id'], 'amount_fc' => 1000], $this->key())
        ->assertCreated()->assertJsonPath('data.amount_fc.amount', 1000)->assertJsonPath('data.fx_gain_loss.amount', 0);
    $after = $this->document('settlements', $r['id']);
    expect($after['unallocated_fc']['amount'])->toBe(0)->and($this->document('invoices', $b['id'])['amount_due']['amount'])->toBe(4500)
        ->and($this->balance('1100'))->toBe(4500);
    $this->inTenant(fn () => expect(LedgerChecks::problems())->toBe([]));
});

it('applies credit on account at the receipt rate and books the exchange difference (D9)', function (): void {
    // Receipt EUR 1,000 at 1.20 on account (1,200 credit); invoice EUR 1,000 carried at 1.10 (1,100): the credit is worth 100 more → gain 100.
    $this->t->rate('EUR', '2026-03-01', '1.10');
    $inv = $this->postedDoc('invoices', $this->t->body($this->t->customer, [[1000, '1', null, '0', '4010']], '2026-03-01', ['currency' => 'EUR', 'fx_rate' => '1.10']));
    $r = $this->postedSettlement('receipt', $this->t->customer, 1000, [], '2026-03-10', '1200', ['currency' => 'EUR', 'fx_rate' => '1.20']);
    expect($r['unallocated']['amount'])->toBe(1200);

    $res = $this->asPerson($this->owner, signing: true)->postJson($this->api("settlements/{$r['id']}/allocate"), ['invoice_id' => $inv['id'], 'amount_fc' => 1000], $this->key())->assertCreated()->json('data');
    expect($res['fx_gain_loss']['amount'])->toBe(100)->and($res['source_amount']['amount'])->toBe(1200)->and($res['amount']['amount'])->toBe(1100)
        ->and($this->t->journalOf($res['journal_id']))->toBe(['1100' => ['debit' => 1200, 'credit' => 1100], '7100' => ['debit' => 0, 'credit' => 100]])
        ->and($this->balance('1100'))->toBe(0);
});

it('refunds a credit note: Dr AR, Cr bank, and the credit note is settled', function (): void {
    $cn = $this->postedDoc('invoices', $this->t->body($this->t->customer, [[2000, '1']], '2026-03-15', ['kind' => 'credit_note']));
    expect($cn['total']['amount'])->toBe(2000);
    $r = $this->postedSettlement('refund', $this->t->customer, 2000, [[$cn['id'], 2000]]);
    expect($r['number'])->toBe('CRF-FY2026-00001')
        ->and($this->t->journalOf($r['journal_id']))->toBe(['1000' => ['debit' => 0, 'credit' => 2000], '1100' => ['debit' => 2000, 'credit' => 0]])
        ->and($this->document('invoices', $cn['id'])['amount_due']['amount'])->toBe(0);

    // A refund pays back only credit that exists: more than the credit note, or nothing allocated, is refused.
    $cn2 = $this->postedDoc('invoices', $this->t->body($this->t->customer, [[500, '1']], '2026-03-15', ['kind' => 'credit_note']));
    $this->asPerson($this->accountant)->postJson($this->api('settlements'), $this->settlementBody('refund', $this->t->customer, 700, [[$cn2['id'], 700]]), $this->key())
        ->assertUnprocessable()->assertJsonPath('code', 'allocation_exceeds_open_amount');
    $this->asPerson($this->accountant)->postJson($this->api('settlements'), $this->settlementBody('refund', $this->t->customer, 300, [[$cn2['id'], 200]]), $this->key())
        ->assertUnprocessable()->assertJsonPath('code', 'refund_not_fully_allocated');
});

it('refunds a supplier: Dr bank, Cr AP, settling a debit note', function (): void {
    $dn = $this->postedDoc('bills', $this->t->body($this->t->supplier, [[3000, '1', null, '0', '5000']], '2026-03-15', ['kind' => 'debit_note']));
    $r = $this->postedSettlement('supplier_refund', $this->t->supplier, 3000, [[$dn['id'], 3000]]);
    expect($r['number'])->toBe('SRF-FY2026-00001')
        ->and($this->t->journalOf($r['journal_id']))->toBe(['1000' => ['debit' => 3000, 'credit' => 0], '2000' => ['debit' => 0, 'credit' => 3000]]);
});

it('refunds an overpayment held as credit on account', function (): void {
    $r = $this->postedSettlement('receipt', $this->t->customer, 1500);
    expect($r['unallocated_fc']['amount'])->toBe(1500);
    $refund = $this->postedDoc('settlements', ['kind' => 'refund', 'contact_id' => $this->t->customer, 'cash_account_id' => $this->f->account('1000'), 'settlement_date' => '2026-03-25',
        'amount_fc' => 1500, 'allocations' => [['source_settlement_id' => $r['id'], 'amount_fc' => 1500]]]);
    expect($this->document('settlements', $r['id'])['unallocated_fc']['amount'])->toBe(0)->and($refund['status'])->toBe('posted')->and($this->balance('1100'))->toBe(0);

    // Reversing the receipt is refused while its credit was refunded; reversing the refund first restores it.
    $this->asPerson($this->owner, signing: true)->postJson($this->api("settlements/{$r['id']}/reverse"), [], $this->key())->assertUnprocessable()->assertJsonPath('code', 'settlement_credit_applied');
    $this->asPerson($this->owner, signing: true)->postJson($this->api("settlements/{$refund['id']}/reverse"), [], $this->key())->assertOk();
    expect($this->document('settlements', $r['id'])['unallocated_fc']['amount'])->toBe(1500);
    $this->asPerson($this->owner, signing: true)->postJson($this->api("settlements/{$r['id']}/reverse"), [], $this->key())->assertOk()->assertJsonPath('data.status', 'reversed');
    expect($this->balance('1100'))->toBe(0)->and($this->balance('1000'))->toBe(0);
});

it('applies a posted credit note to an open invoice, limited by both open amounts', function (): void {
    $inv = $this->sale();   // 11,000
    $cn = $this->postedDoc('invoices', $this->t->body($this->t->customer, [[2727, '1', 'VAT10']], '2026-03-16', ['kind' => 'credit_note', 'related_invoice_id' => $inv['id']])); // 2,727 + 273 = 3,000
    expect($cn['total']['amount'])->toBe(3000);

    $this->asPerson($this->owner, signing: true)->postJson($this->api("invoices/{$cn['id']}/allocate"), ['invoice_id' => $inv['id'], 'amount_fc' => 3500], $this->key())
        ->assertUnprocessable()->assertJsonPath('code', 'credit_exceeds_available');
    $this->asPerson($this->owner, signing: true)->postJson($this->api("invoices/{$cn['id']}/allocate"), ['invoice_id' => $inv['id'], 'amount_fc' => 3000], $this->key())->assertCreated();
    expect($this->document('invoices', $inv['id'])['amount_due']['amount'])->toBe(8000)->and($this->document('invoices', $cn['id'])['amount_due']['amount'])->toBe(0)
        ->and($this->balance('1100'))->toBe(8000);

    // Credit notes against one invoice can never add up to more than it: 11,000 less 3,000 leaves 8,000.
    $draft = $this->draftDoc('invoices', $this->t->body($this->t->customer, [[7500, '1', 'VAT10']], '2026-03-17', ['kind' => 'credit_note', 'related_invoice_id' => $inv['id']]));
    $this->asPerson($this->accountant, signing: true)->postJson($this->api("invoices/{$draft['id']}/submit"), [], $this->key())
        ->assertUnprocessable()->assertJsonPath('code', 'credit_exceeds_original');
    // The preview says so too, so the maker hears it before any approver does.
    $this->postJson($this->api("invoices/{$draft['id']}/posting-preview"), [], $this->key())->assertOk()
        ->assertJsonPath('data.valid', false)->assertJsonPath('data.violations.0.code', 'credit_exceeds_original');
});

it('credits a fully paid invoice, leaving a credit that can be refunded', function (): void {
    $inv = $this->sale();   // 11,000
    $this->postedSettlement('receipt', $this->t->customer, 11000, [[$inv['id'], 11000]]);
    expect($this->document('invoices', $inv['id'])['amount_due']['amount'])->toBe(0)->and($this->balance('1100'))->toBe(0);

    // The goods came back after payment: a full credit note is allowed, and the customer now holds the credit.
    $cn = $this->postedDoc('invoices', $this->t->body($this->t->customer, [[10000, '1', 'VAT10']], '2026-03-16', ['kind' => 'credit_note', 'related_invoice_id' => $inv['id']]));
    expect($cn['total']['amount'])->toBe(11000)->and($this->balance('1100'))->toBe(-11000);

    $this->postedSettlement('refund', $this->t->customer, 11000, [[$cn['id'], 11000]]);
    expect($this->balance('1100'))->toBe(0)->and($this->document('invoices', $cn['id'])['amount_due']['amount'])->toBe(0);
});

it('refuses over-allocation, wrong contacts and wrong kinds, naming the reason', function (): void {
    $inv = $this->sale();
    $other = $this->inTenant(fn () => $this->t->contact('C2', 'customer'));
    $post = fn (array $body) => $this->asPerson($this->accountant)->postJson($this->api('settlements'), $body, $this->key());

    $post($this->settlementBody('receipt', $this->t->customer, 12000, [[$inv['id'], 11001]]))->assertUnprocessable()->assertJsonPath('code', 'allocation_exceeds_open_amount');
    $post($this->settlementBody('receipt', $this->t->customer, 5000, [[$inv['id'], 6000]]))->assertUnprocessable()->assertJsonPath('code', 'allocation_exceeds_settlement');
    $post($this->settlementBody('receipt', $other, 5000, [[$inv['id'], 5000]]))->assertUnprocessable()->assertJsonPath('code', 'allocation_contact_mismatch');
    $post($this->settlementBody('payment', $this->t->supplier, 5000, [[$inv['id'], 5000]]))->assertUnprocessable()->assertJsonPath('code', 'allocation_target_invalid');
    $post($this->settlementBody('receipt', $this->t->customer, 5000, [[$inv['id'], 5000]], '2026-03-20', '1200'))->assertCreated(); // EUR-only bank, USD receipt is a posting matter, not a draft one
    $eur = $this->postedDoc('invoices', $this->t->body($this->t->customer, [[1000, '1', null, '0', '4010']], '2026-03-01', ['currency' => 'EUR', 'fx_rate' => '1.10']));
    $post($this->settlementBody('receipt', $this->t->customer, 1000, [[$eur['id'], 1000]]))->assertUnprocessable()->assertJsonPath('code', 'allocation_currency_mismatch');
    $draft = $this->draftDoc('invoices', $this->t->body($this->t->customer, [[1000, '1']]));
    $post($this->settlementBody('receipt', $this->t->customer, 1000, [[$draft['id'], 1000]]))->assertUnprocessable()->assertJsonPath('code', 'allocation_target_not_posted');
});

it('rechecks the open amount under the lock when a draft posts after another receipt took it', function (): void {
    $inv = $this->sale();
    $a = $this->draftDoc('settlements', $this->settlementBody('receipt', $this->t->customer, 11000, [[$inv['id'], 11000]]));
    $b = $this->draftDoc('settlements', $this->settlementBody('receipt', $this->t->customer, 11000, [[$inv['id'], 11000]]));
    $this->submitDoc('settlements', $a['id']);
    $this->asPerson($this->accountant, signing: true)->postJson($this->api("settlements/{$b['id']}/submit"), [], $this->key())
        ->assertUnprocessable()->assertJsonPath('code', 'allocation_exceeds_open_amount');
    expect($this->document('settlements', $b['id'])['status'])->toBe('draft')->and($this->document('invoices', $inv['id'])['settled']['amount'])->toBe(11000);
});

it('reverses a settlement: mirror journal, open amount restored, invoice still not reversible while allocated', function (): void {
    $inv = $this->sale();
    $r = $this->postedSettlement('receipt', $this->t->customer, 11000, [[$inv['id'], 11000]]);
    $this->asPerson($this->owner, signing: true)->postJson($this->api("invoices/{$inv['id']}/reverse"), [], $this->key())->assertUnprocessable()->assertJsonPath('code', 'invoice_has_settlements');

    $rev = $this->asPerson($this->owner, signing: true)->postJson($this->api("settlements/{$r['id']}/reverse"), [], $this->key())->assertOk()->assertJsonPath('data.status', 'reversed')->json('data');
    $after = $this->document('invoices', $inv['id']);
    expect($rev['reversal_journal_id'])->not->toBeNull()->and($after['settled']['amount'])->toBe(0)->and($after['payment_status'])->toBe('awaiting_payment')
        ->and($this->balance('1000'))->toBe(0)->and($this->balance('1100'))->toBe(11000);
    $this->asPerson($this->owner, signing: true)->postJson($this->api("settlements/{$r['id']}/reverse"), [], $this->key())->assertForbidden(); // the policy hides reverse on a reversed settlement
    $this->inTenant(fn () => expect(LedgerChecks::problems())->toBe([]));
    // The settlement's journal cannot be reversed on its own: that would leave the sub-ledger behind.
    $r2 = $this->postedSettlement('receipt', $this->t->customer, 1000);
    $this->asPerson($this->owner, signing: true)->postJson($this->api("journals/{$r2['journal_id']}/reverse"), [], $this->key())->assertClientError();
});

it('refuses reversing a receipt whose credit was applied until the application is undone', function (): void {
    $b = $this->sale(5000);
    $r = $this->postedSettlement('receipt', $this->t->customer, 1000);
    $app = $this->asPerson($this->owner, signing: true)->postJson($this->api("settlements/{$r['id']}/allocate"), ['invoice_id' => $b['id'], 'amount_fc' => 1000], $this->key())->assertCreated()->json('data');
    $this->asPerson($this->owner, signing: true)->postJson($this->api("settlements/{$r['id']}/reverse"), [], $this->key())->assertUnprocessable()->assertJsonPath('code', 'settlement_credit_applied');

    $this->asPerson($this->owner, signing: true)->postJson($this->api("credit-applications/{$app['id']}/undo"), [], $this->key())->assertOk()->assertJsonPath('data.reversed_at', fn ($v) => $v !== null);
    expect($this->document('settlements', $r['id'])['unallocated_fc']['amount'])->toBe(1000)->and($this->document('invoices', $b['id'])['settled']['amount'])->toBe(0);
    $this->asPerson($this->owner, signing: true)->postJson($this->api("credit-applications/{$app['id']}/undo"), [], $this->key())->assertForbidden();
    $this->asPerson($this->owner, signing: true)->postJson($this->api("settlements/{$r['id']}/reverse"), [], $this->key())->assertOk();
    $this->inTenant(fn () => expect(LedgerChecks::problems())->toBe([]));
});

it('is another company\'s 404 and a foreign id in the body a 422', function (): void {
    $inv = $this->sale();
    $r = $this->postedSettlement('receipt', $this->t->customer, 11000, [[$inv['id'], 11000]]);
    $other = $this->secondCompany();
    $both = $this->person('Both Owner', ['Owner']);
    $this->inTenant(fn () => app(AssignCompanyRole::class)->handle($this->f->actor, new CompanyRoleInput($both->id, $other->id, 'Owner')));
    $this->asPerson($both)->getJson($this->api("settlements/{$r['id']}", $other->id))->assertNotFound();
    $this->asPerson($both, signing: true)->postJson($this->api("settlements/{$r['id']}/reverse", $other->id), [], $this->key())->assertNotFound();
    $this->asPerson($both, signing: true)->postJson($this->api("settlements/{$r['id']}/allocate", $other->id), ['invoice_id' => $inv['id'], 'amount_fc' => 1], $this->key())->assertNotFound();

    $this->asPerson($this->accountant)->postJson($this->api('settlements'), $this->settlementBody('receipt', (string) Str::uuid(), 100), $this->key())->assertUnprocessable()->assertJsonValidationErrors('contact_id');
    $this->asPerson($this->accountant)->postJson($this->api('settlements'), $this->settlementBody('receipt', $this->t->customer, 100, [[(string) Str::uuid(), 100]]), $this->key())->assertUnprocessable()->assertJsonValidationErrors('allocations.0.invoice_id');
});

it('replays an idempotent create without creating a second settlement', function (): void {
    $key = $this->key();
    $body = $this->settlementBody('receipt', $this->t->customer, 2500);
    $first = $this->asPerson($this->accountant)->postJson($this->api('settlements'), $body, $key)->assertCreated()->json('data.id');
    $this->asPerson($this->accountant)->postJson($this->api('settlements'), $body, $key)->assertCreated()->assertHeader('Idempotent-Replayed', 'true')->assertJsonPath('data.id', $first);
    $this->inTenant(fn () => expect(DB::table('settlements')->count())->toBe(1));
});

it('approves through a workflow: the maker cannot, another person can, and the number stays gapless', function (): void {
    $this->workflow('settlement');
    $inv = $this->sale();
    $draft = $this->draftDoc('settlements', $this->settlementBody('receipt', $this->t->customer, 11000, [[$inv['id'], 11000]]));
    $pending = $this->submitDoc('settlements', $draft['id']);
    expect($pending['status'])->toBe('pending_approval')->and($pending['number'])->toBeNull();

    $this->asPerson($this->accountant, signing: true)->postJson($this->api("settlements/{$draft['id']}/approve"), [], $this->key())->assertForbidden();
    $this->asPerson($this->approver, signing: true)->postJson($this->api("settlements/{$draft['id']}/approve"), [], $this->key())
        ->assertOk()->assertJsonPath('data.status', 'posted')->assertJsonPath('data.number', 'RCT-FY2026-00001')->assertJsonPath('data.approved_by', $this->approver->id);
    $this->inTenant(fn () => expect(LedgerChecks::problems())->toBe([])->and(DB::table('approval_requests')->where('document_type', 'settlement')->where('status', 'approved')->count())->toBe(1));
});

it('refuses posting into a closed period and takes nothing from the sequence', function (): void {
    $inv = $this->sale();
    $this->inTenant(fn () => $this->f->setPeriodStatus('2026-03-20', 'closed'));
    $draft = $this->draftDoc('settlements', $this->settlementBody('receipt', $this->t->customer, 11000, [[$inv['id'], 11000]]));
    $this->asPerson($this->accountant, signing: true)->postJson($this->api("settlements/{$draft['id']}/submit"), [], $this->key())->assertUnprocessable()->assertJsonPath('code', 'period_closed');
    $this->inTenant(function () use ($inv): void {
        expect(DB::table('sequences')->where('sequence_key', 'doc:receipt:FY2026')->exists())->toBeFalse()
            ->and((int) DB::table('invoices')->where('id', $inv['id'])->value('settled'))->toBe(0);
    });
});

it('lets a token draft and submit settlements but never approve, reverse or apply credit, and reads payment runs only', function (): void {
    $inv = $this->sale();
    $token = $this->newToken(['settlements:read', 'settlements:write', 'settlements:submit', 'payment-runs:read']);
    $created = $this->asToken($token)->postJson($this->api('settlements'), $this->settlementBody('receipt', $this->t->customer, 11000, [[$inv['id'], 11000]]), $this->key())->assertCreated()->json('data');
    $this->asToken($token)->postJson($this->api("settlements/{$created['id']}/submit"), [], $this->key())->assertOk()->assertJsonPath('data.status', 'posted');
    $this->asToken($token)->postJson($this->api("settlements/{$created['id']}/reverse"), [], $this->key())->assertForbidden();
    $this->asToken($token)->postJson($this->api("settlements/{$created['id']}/allocate"), ['invoice_id' => $inv['id'], 'amount_fc' => 1], $this->key())->assertForbidden();
    $this->asToken($token)->getJson($this->api('payment-runs'))->assertOk();
    $this->asToken($token)->postJson($this->api('payment-runs'), ['items' => []], $this->key())->assertForbidden();
});
