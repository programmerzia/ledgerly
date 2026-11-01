<?php

declare(strict_types=1);

use App\Actions\Trade\CreateInvoiceDraft;
use App\Actions\Trade\CreatePaymentRunDraft;
use App\Actions\Trade\CreateSettlementDraft;
use App\Actions\Trade\Inputs\InvoiceDraftInput;
use App\Actions\Trade\Inputs\InvoiceLineInput;
use App\Actions\Trade\Inputs\PaymentRunDraftInput;
use App\Actions\Trade\Inputs\SettlementAllocationInput;
use App\Actions\Trade\Inputs\SettlementDraftInput;
use App\Actions\Workflow\Inputs\DocumentRef;
use App\Actions\Workflow\SubmitDocument;
use App\Domain\Ledger\DraftLine;
use App\Domain\Ledger\JournalType;
use App\Domain\Trade\InvoiceKind;
use Illuminate\Support\Facades\DB;
use Tests\Support\FxScenario as S;
use Tests\Support\LedgerChecks;
use Tests\Support\LedgerFixture;
use Tests\Support\Race;
use Tests\Support\TradeFixture;

/*
 * 13 §8: a settlement locks the period, itself (and settlements whose credit it refunds), then its invoices by id, then
 * sequences and balances. Racing settlements over the same invoices, in opposite orders, must not deadlock and must never
 * allocate more than an invoice has open.
 */

function postedInvoice(LedgerFixture $f, TradeFixture $t, InvoiceKind $kind, string $contact, int $price, string $account): string
{
    $draft = app(CreateInvoiceDraft::class)->handle($f->actor, new InvoiceDraftInput(
        $f->companyId, $kind, $contact, new DateTimeImmutable('2026-03-10'),
        [new InvoiceLineInput('1', accountId: $f->account($account), unitPriceFc: $price)],
    ));
    app(SubmitDocument::class)->handle($f->signedActor(), new DocumentRef($kind->documentType(), $draft->id));

    return $draft->id;
}

it('never over-allocates and never deadlocks when settlements allocate two invoices in opposite orders', function (): void {
    $this->grant('invoices.create', 'invoices.submit', 'receipts.create');
    $f = LedgerFixture::create();
    $t = TradeFixture::prepare($f);
    $a = postedInvoice($f, $t, InvoiceKind::SalesInvoice, $t->customer, 11000, '4000');
    $b = postedInvoice($f, $t, InvoiceKind::SalesInvoice, $t->customer, 11000, '4000');
    $users = [Race::user($f, 'Amina'), Race::user($f, 'Kenneth'), Race::user($f, 'Farah'), Race::user($f, 'Omar')];

    // Four receipts of 4,000 per invoice: 11,000 open on each, so at most two of them fit.
    $drafts = [];
    foreach ([[$a, $b], [$b, $a], [$a, $b], [$b, $a]] as [$first, $second]) {
        $drafts[] = app(CreateSettlementDraft::class)->handle($f->signedActor(), new SettlementDraftInput(
            $f->companyId, 'receipt', $t->customer, $f->account('1000'), new DateTimeImmutable('2026-03-20'), 8000,
            [new SettlementAllocationInput(4000, invoiceId: $first), new SettlementAllocationInput(4000, invoiceId: $second)],
        ))->id;
    }

    $flat = Race::flatten(Race::run($f, array_map(fn (string $id, string $user) => [['op' => 'submit_settlement', 'id' => $id, 'user' => $user]], $drafts, $users)));

    expect(Race::errors($flat))->toBe([], 'a deadlock or another raw error surfaced to the caller')
        ->and(Race::ok($flat))->toHaveCount(2)
        ->and(Race::refusals($flat))->toBe(['allocation_exceeds_open_amount', 'allocation_exceeds_open_amount'])
        ->and((int) DB::table('invoices')->where('id', $a)->value('settled'))->toBe(8000)
        ->and((int) DB::table('invoices')->where('id', $b)->value('settled'))->toBe(8000)
        ->and(DB::table('settlements')->where('status', 'posted')->pluck('number')->sort()->values()->all())->toBe(['RCT-FY2026-00001', 'RCT-FY2026-00002'])
        ->and(DB::table('settlements')->where('status', 'draft')->count())->toBe(2)
        ->and(LedgerChecks::problems())->toBe([]);
})->group('concurrency');

it('posts a payment run exactly once when two approvers race to sign it', function (): void {
    $this->grant('invoices.create', 'invoices.submit', 'bills.create', 'bills.submit', 'payments.create');
    $f = LedgerFixture::create();
    $t = TradeFixture::prepare($f);
    $bills = [
        postedInvoice($f, $t, InvoiceKind::PurchaseBill, $t->supplier, 5000, '5000'),
        postedInvoice($f, $t, InvoiceKind::PurchaseBill, $t->supplierWht, 10000, '5000'),
    ];
    Race::workflow($f, [['role' => 'Approver', 'count' => 1]], 'payment_run');
    $people = [Race::user($f, 'Amina'), Race::user($f, 'Kenneth')];
    $run = app(CreatePaymentRunDraft::class)->handle($f->signedActor(), new PaymentRunDraftInput(
        $f->companyId, $f->account('1000'), new DateTimeImmutable('2026-03-25'), [['invoice_id' => $bills[0], 'amount_fc' => 5000], ['invoice_id' => $bills[1], 'amount_fc' => 9000]],
    ));
    app(SubmitDocument::class)->handle($f->signedActor(), new DocumentRef('payment_run', $run->id));
    expect(DB::table('payment_runs')->where('id', $run->id)->value('status'))->toBe('pending_approval');

    $flat = Race::flatten(Race::run($f, array_map(fn (string $who) => [['op' => 'approve_run', 'id' => $run->id, 'user' => $who]], $people)));

    expect(Race::errors($flat))->toBe([])
        ->and(Race::ok($flat))->toHaveCount(1)
        ->and(Race::refusals($flat))->toBe(['document_not_pending'])
        ->and(DB::table('payment_runs')->where('id', $run->id)->value('status'))->toBe('posted')
        ->and(DB::table('payment_runs')->where('id', $run->id)->value('number'))->toBe('RUN-FY2026-00001')
        ->and(DB::table('settlements')->where('payment_run_id', $run->id)->count())->toBe(2)
        ->and(DB::table('wht_certificates')->count())->toBe(1)
        ->and(DB::table('invoices')->whereIn('id', $bills)->sum('settled'))->toEqual(14000)
        ->and(DB::table('journals')->where('source_type', 'settlement')->count())->toBe(2)
        ->and(LedgerChecks::problems())->toBe([]);
})->group('concurrency');

it('reverses a settlement and allocates the same invoice at once without losing or doubling the open amount', function (): void {
    $this->grant('invoices.create', 'invoices.submit', 'receipts.create');
    $f = LedgerFixture::create();
    $t = TradeFixture::prepare($f);
    $a = postedInvoice($f, $t, InvoiceKind::SalesInvoice, $t->customer, 10000, '4000');
    $mk = fn () => app(CreateSettlementDraft::class)->handle($f->signedActor(), new SettlementDraftInput(
        $f->companyId, 'receipt', $t->customer, $f->account('1000'), new DateTimeImmutable('2026-03-20'), 10000, [new SettlementAllocationInput(10000, invoiceId: $a)],
    ))->id;
    $first = $mk();
    $second = $mk();   // both drafts are accepted while nothing is allocated; only one can hold the invoice at a time
    app(SubmitDocument::class)->handle($f->signedActor(), new DocumentRef('settlement', $first));

    $flat = Race::flatten(Race::run($f, [
        [['op' => 'reverse_settlement', 'id' => $first, 'user' => $f->userId]],
        [['op' => 'submit_settlement', 'id' => $second, 'user' => $f->userId]],
    ]));

    expect(Race::errors($flat))->toBe([]);
    $settled = (int) DB::table('invoices')->where('id', $a)->value('settled');
    $posted = DB::table('settlements')->where('status', 'posted')->count();
    expect($settled)->toBe($posted * 10000)->and($settled)->toBeLessThanOrEqual(10000)->and(LedgerChecks::problems())->toBe([]);
})->group('concurrency');

it('lets a revaluation and a posting race: the revaluation sees every posting that beat it and none behind it', function (): void {
    $f = LedgerFixture::create();
    S::prepare($f);
    // EUR 1,000.00 on the bank at 1.10 = 1,100.00; closing rate 1.12.
    S::post($f, JournalType::Bank, [S::fc($f, '1200', 'EUR', 100000, '1.10000000', 110000), new DraftLine($f->account('4000'), credit: 110000)], '2026-03-10');
    S::rate($f, 'EUR', '2026-03-31', '1.12000000');
    $period = $f->period('2026-03-15')->id;
    $draft = draftJournal($f, [S::fc($f, '1200', 'EUR', 50000, '1.10000000', 55000), new DraftLine($f->account('4000'), credit: 55000)], '2026-03-12', JournalType::Bank);

    $flat = Race::flatten(Race::run($f, [
        [['op' => 'revalue', 'id' => $period, 'user' => $f->userId, 'delay_ms' => random_int(0, 30)]],
        [['op' => 'post', 'id' => $draft->id, 'user' => $f->userId]],
    ]));

    expect(Race::errors($flat))->toBe([], 'a deadlock or another raw error surfaced to the caller')
        ->and(Race::ok($flat))->toHaveCount(2);
    $reval = DB::table('journals')->where('source_type', 'fx_revaluation')->where('journal_type', 'fx')->orderBy('journal_date')->first();
    $post = DB::table('journals')->where('id', $draft->id)->first();
    // 1,000 EUR revalues by 20.00, 1,500 EUR by 30.00: the run includes the posting exactly when the posting committed first.
    // Test clocks are frozen, so order comes from the workers' own timing: clearly-first decides the figure; an overlap may land either way,
    // but only on one of the two consistent figures (never a half-seen posting).
    $revalOp = array_values(array_filter($flat, fn ($r) => $r['op'] === 'revalue'))[0];
    $postOp = array_values(array_filter($flat, fn ($r) => $r['op'] === 'post'))[0];
    $allowed = $postOp['finished'] < $revalOp['started'] ? [3000] : ($revalOp['finished'] < $postOp['started'] ? [2000] : [2000, 3000]);
    expect($allowed)->toContain((int) DB::table('fx_revaluations')->where('fiscal_period_id', $period)->value('total_unrealised'))
        ->and($reval)->not->toBeNull()
        ->and(LedgerChecks::problems())->toBe([]);
})->group('concurrency');
