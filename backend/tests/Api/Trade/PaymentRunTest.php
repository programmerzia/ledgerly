<?php

declare(strict_types=1);

use Illuminate\Support\Facades\DB;
use Tests\Support\LedgerChecks;

/*
 * Payment runs and WHT certificates (PRD 4.6). Bill S1a 5,000 and S1b 3,000 (supplier S1, no tax); bill S2 10,000 for supplier S2
 * who is withheld at 10%: 1,000 is withheld when the bill posts, so AP carries and the payment settles 9,000.
 */

beforeEach(function (): void {
    $this->setUpTrade();
});

it('posts one payment per supplier in one transaction, with gapless numbers and a WHT certificate', function (): void {
    [$a, $b, $c] = $this->threeBills();
    expect($c['wht_amount']['amount'])->toBe(1000)->and($c['amount_due']['amount'])->toBe(9000);
    $this->workflow('payment_run');

    $run = $this->asPerson($this->accountant)->postJson($this->api('payment-runs'), $this->runBody([[$a['id'], 5000], [$b['id'], 3000], [$c['id'], 9000]]), $this->key())->assertCreated()->json('data');
    expect($run['status'])->toBe('draft')->and($run['total_net']['amount'])->toBe(17000)->and($run['total_wht']['amount'])->toBe(1000)->and($run['total_gross']['amount'])->toBe(18000);
    $this->asPerson($this->accountant)->postJson($this->api("payment-runs/{$run['id']}/posting-preview"), [], $this->key())->assertOk()->assertJsonPath('data.valid', true);

    $this->asPerson($this->accountant, signing: true)->postJson($this->api("payment-runs/{$run['id']}/submit"), [], $this->key())->assertOk()->assertJsonPath('data.status', 'pending_approval');
    $this->asPerson($this->accountant, signing: true)->postJson($this->api("payment-runs/{$run['id']}/approve"), [], $this->key())->assertForbidden();
    $posted = $this->asPerson($this->approver, signing: true)->postJson($this->api("payment-runs/{$run['id']}/approve"), [], $this->key())
        ->assertOk()->assertJsonPath('data.status', 'posted')->assertJsonPath('data.number', 'RUN-FY2026-00001')->json('data');

    $this->inTenant(function () use ($posted, $a, $b, $c): void {
        $settlements = DB::table('settlements')->where('payment_run_id', $posted['id'])->orderBy('number')->get();
        expect($settlements)->toHaveCount(2)->and($settlements->pluck('number')->all())->toBe(['PAY-FY2026-00001', 'PAY-FY2026-00002'])
            ->and($settlements->pluck('amount')->map(fn ($v) => (int) $v)->sort()->values()->all())->toBe([8000, 9000])
            ->and($settlements->pluck('status')->unique()->all())->toBe(['posted'])
            ->and($settlements->pluck('approved_by')->unique()->all())->toBe([$this->approver->id]);
        foreach ([$a, $b, $c] as $bill) {
            expect((int) DB::table('invoices')->where('id', $bill['id'])->value('settled'))->toBe($bill === $c ? 9000 : $bill['total']['amount']);
        }
        $cert = DB::table('wht_certificates')->first();
        expect(DB::table('wht_certificates')->count())->toBe(1)->and($cert->number)->toBe('WHT-FY2026-00001')->and((int) $cert->wht_amount)->toBe(1000)
            ->and((int) $cert->base_amount)->toBe(10000)->and($cert->invoice_id)->toBe($c['id'])->and($cert->status)->toBe('issued')
            ->and(LedgerChecks::problems())->toBe([]);
    });
    expect($this->balance('2000'))->toBe(0)->and($this->balance('1000'))->toBe(-17000);
});

it('clears AP and holds the withheld tax on the WHT payable account', function (): void {
    [$a, $b, $c] = $this->threeBills();
    $run = $this->asPerson($this->accountant)->postJson($this->api('payment-runs'), $this->runBody([[$a['id'], 5000], [$b['id'], 3000], [$c['id'], 9000]]), $this->key())->assertCreated()->json('data');
    $posted = $this->asPerson($this->accountant, signing: true)->postJson($this->api("payment-runs/{$run['id']}/submit"), [], $this->key())->assertOk()->assertJsonPath('data.status', 'posted')->json('data');
    expect($posted['number'])->toBe('RUN-FY2026-00001')
        ->and($this->balance('2000'))->toBe(0)          // 5,000 + 3,000 + 9,000 owed, 17,000 paid
        ->and($this->balance('2120'))->toBe(-1000)       // the withheld 1,000 is still owed to the tax authority
        ->and($this->balance('1000'))->toBe(-17000);
    $this->inTenant(fn () => expect(LedgerChecks::problems())->toBe([])->and(DB::table('wht_certificates')->count())->toBe(1));

    $csv = $this->asPerson($this->accountant)->get($this->api("payment-runs/{$run['id']}/export"))->assertOk()->streamedContent();
    $rows = array_map('str_getcsv', array_filter(explode("\n", $csv)));
    expect($rows[0])->toBe(['payee_code', 'payee_name', 'bills', 'amount', 'currency', 'payment_date', 'run_number'])
        ->and($rows)->toHaveCount(3)->and(array_column($rows, 3))->toContain('80.00', '90.00');
});

it('refuses the whole run when one bill was paid since it was drafted, leaving nothing partial', function (): void {
    [$a, $b] = $this->threeBills();
    $run = $this->asPerson($this->accountant)->postJson($this->api('payment-runs'), $this->runBody([[$a['id'], 5000], [$b['id'], 3000]]), $this->key())->assertCreated()->json('data');
    $this->postedSettlement('payment', $this->t->supplier, 3000, [[$b['id'], 3000]]);

    $this->asPerson($this->accountant, signing: true)->postJson($this->api("payment-runs/{$run['id']}/submit"), [], $this->key())->assertUnprocessable();
    $this->inTenant(function () use ($a): void {
        expect(DB::table('settlements')->count())->toBe(1)->and((int) DB::table('invoices')->where('id', $a['id'])->value('settled'))->toBe(0)
            ->and(DB::table('sequences')->where('sequence_key', 'doc:payment_run:FY2026')->exists())->toBeFalse();
    });
});

it('issues WHT certificates pro rata to what a payment covers; the payment that clears the bill takes the rest, and reversing voids them', function (): void {
    [, , $c] = $this->threeBills();   // open 9,000, withheld 1,000 on a 10,000 base
    $p1 = $this->postedSettlement('payment', $this->t->supplierWht, 4000, [[$c['id'], 4000]]);   // 4,000 / 9,000 → 444.44 → 444 wht, base 4,444
    $p2 = $this->postedSettlement('payment', $this->t->supplierWht, 5000, [[$c['id'], 5000]]);   // clears: 1,000 − 444 = 556, base 10,000 − 4,444 = 5,556
    $this->inTenant(function () use ($p1, $p2): void {
        $rows = DB::table('wht_certificates')->orderBy('number')->get();
        expect($rows->pluck('wht_amount')->map(fn ($v) => (int) $v)->all())->toBe([444, 556])->and($rows->pluck('base_amount')->map(fn ($v) => (int) $v)->all())->toBe([4444, 5556])
            ->and($rows->pluck('number')->all())->toBe(['WHT-FY2026-00001', 'WHT-FY2026-00002'])->and($rows[0]->payment_id)->toBe($p1['id'])->and($rows[1]->payment_id)->toBe($p2['id']);
    });

    $this->asPerson($this->owner, signing: true)->postJson($this->api("settlements/{$p2['id']}/reverse"), [], $this->key())->assertOk();
    $this->inTenant(fn () => expect(DB::table('wht_certificates')->orderBy('number')->pluck('status')->all())->toBe(['issued', 'void'])->and(LedgerChecks::problems())->toBe([]));
    // Paying the rest again issues the remainder against the one certificate still valid: 1,000 − 444 = 556, with a new gapless number.
    $this->postedSettlement('payment', $this->t->supplierWht, 5000, [[$c['id'], 5000]]);
    $this->inTenant(fn () => expect(DB::table('wht_certificates')->where('status', 'issued')->sum('wht_amount'))->toEqual(1000));

    $this->asPerson($this->accountant)->getJson($this->api('wht-certificates'))->assertOk()->assertJsonCount(3, 'data');
    $this->asPerson($this->accountant)->getJson($this->api('wht-certificates?status=void'))->assertOk()->assertJsonCount(1, 'data');
});

it('keeps tokens to reading payment runs and lets nobody but the maker void a draft they did not make only with approval rights', function (): void {
    [$a] = $this->threeBills();
    $run = $this->asPerson($this->accountant)->postJson($this->api('payment-runs'), $this->runBody([[$a['id'], 5000]]), $this->key())->assertCreated()->json('data');
    $this->asPerson($this->assistant)->postJson($this->api("payment-runs/{$run['id']}/void"), ['reason' => 'x'], $this->key())->assertForbidden();
    $this->asPerson($this->accountant)->postJson($this->api("payment-runs/{$run['id']}/void"), ['reason' => 'changed my mind'], $this->key())->assertOk()->assertJsonPath('data.status', 'void');
    $this->asPerson($this->accountant)->getJson($this->api("payment-runs/{$run['id']}/export"))->assertUnprocessable()->assertJsonPath('code', 'payment_run_not_posted');
});
