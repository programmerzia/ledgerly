<?php

declare(strict_types=1);

use App\Actions\Trade\ApplyCredit;
use App\Actions\Trade\CreateInvoiceDraft;
use App\Actions\Trade\CreateSettlementDraft;
use App\Actions\Trade\Inputs\ApplyCreditInput;
use App\Actions\Trade\Inputs\InvoiceDraftInput;
use App\Actions\Trade\Inputs\InvoiceLineInput;
use App\Actions\Trade\Inputs\ReverseSettlementInput;
use App\Actions\Trade\Inputs\SettlementAllocationInput;
use App\Actions\Trade\Inputs\SettlementDraftInput;
use App\Actions\Trade\ReverseSettlement;
use App\Actions\Trade\UndoCreditApplication;
use App\Actions\Workflow\Inputs\DocumentRef;
use App\Actions\Workflow\SubmitDocument;
use App\Contracts\PermissionChecker;
use App\Domain\Ledger\PostingRejected;
use App\Domain\Shared\DomainRuleViolation;
use App\Domain\Trade\InvoiceKind;
use App\Support\Testing\GrantedPermissions;
use Illuminate\Support\Facades\DB;
use Tests\Support\LedgerChecks;
use Tests\Support\LedgerFixture;
use Tests\Support\TradeFixture;

/*
 * Property-style over the sub-ledger (D9): a seeded random mix of invoices and bills in USD and EUR (at odd rates, so rounding and
 * exchange differences happen), receipts and payments that over- and under-pay, credit notes, refunds, credit applications and their
 * undoing, and reversals. Whatever the refusals along the way, afterwards the AR and AP control accounts equal the open documents less
 * the credits per contact, every settled amount equals the allocations behind it and the other detectives are clean.
 */

it('ties the control accounts to open documents less credits through a random settlement mix', function (int $seed): void {
    mt_srand($seed);
    app()->instance(PermissionChecker::class, new GrantedPermissions([
        'invoices.create', 'invoices.submit', 'bills.create', 'bills.submit', 'receipts.create', 'payments.create', 'receipts.reverse', 'payments.reverse',
    ]));
    $f = LedgerFixture::create();
    $t = TradeFixture::prepare($f);
    $actor = $f->signedActor();
    DB::table('accounts')->whereIn('code', ['2120', '2110', '2100'])->update(['currency_policy' => 'any']);   // tax accounts take the document currency here
    $rates = ['1.00000000', '1.10000000', '1.13370000', '0.87654321'];
    foreach (['2026-03-01', '2026-03-10'] as $day) {
        $t->rate('EUR', $day, '1.10');
    }

    $docs = ['sales' => [], 'bills' => [], 'credit' => [], 'debit' => []];   // id => currency
    $settlements = [];
    $applications = [];
    $attempt = function (Closure $work) {
        try {
            return $work();
        } catch (DomainRuleViolation|PostingRejected) {
            return null;   // a refusal is a valid answer; the invariants must hold regardless
        }
    };
    $document = function (InvoiceKind $kind, string $contact, string $account, ?string $related = null) use ($f, $actor, $rates) {
        $currency = mt_rand(0, 2) === 0 ? 'EUR' : 'USD';
        $draft = app(CreateInvoiceDraft::class)->handle($actor, new InvoiceDraftInput(
            $f->companyId, $kind, $contact, new DateTimeImmutable('2026-03-0'.mt_rand(1, 9)),
            [new InvoiceLineInput('1', accountId: $f->account($currency === 'EUR' ? ($kind->isSales() ? '4010' : '5010') : $account), unitPriceFc: mt_rand(100, 90000))],
            currency: $currency, fxRate: $currency === 'EUR' ? $rates[mt_rand(1, 3)] : null, relatedInvoiceId: $related,
        ));
        try {
            app(SubmitDocument::class)->handle($actor, new DocumentRef($kind->documentType(), $draft->id));
        } catch (PostingRejected $e) {
            throw new RuntimeException('document: '.implode(',', array_map(fn ($v) => $v->code.' '.$v->message, $e->violations)));
        }

        return [$draft->id, $currency];
    };

    for ($step = 0; $step < 60; $step++) {
        $roll = mt_rand(1, 100);
        $pick = fn (array $pool) => $pool === [] ? null : array_keys($pool)[mt_rand(0, count($pool) - 1)];
        if ($roll <= 15) {
            [$id, $cur] = $document(InvoiceKind::SalesInvoice, $t->customer, '4000');
            $docs['sales'][$id] = $cur;
        } elseif ($roll <= 28) {
            [$id, $cur] = $document(InvoiceKind::PurchaseBill, mt_rand(0, 1) ? $t->supplier : $t->supplierWht, '5000');
            $docs['bills'][$id] = $cur;
        } elseif ($roll <= 36) {
            [$id, $cur] = $document(InvoiceKind::CreditNote, $t->customer, '4000');
            $docs['credit'][$id] = $cur;
        } elseif ($roll <= 40) {
            [$id, $cur] = $document(InvoiceKind::DebitNote, $t->supplier, '5000');
            $docs['debit'][$id] = $cur;
        } elseif ($roll <= 75) {
            // A receipt or payment against a random open document, paying a random share of it, or a bit more.
            $kind = mt_rand(0, 1) ? 'receipt' : 'payment';
            $targetId = $pick($kind === 'receipt' ? $docs['sales'] : $docs['bills']);
            $inv = $targetId === null ? null : DB::table('invoices')->where('id', $targetId)->first();
            if ($inv === null || $inv->status !== 'posted') {
                continue;
            }
            $open = $inv->total_fc - $inv->wht_amount_fc - $inv->settled_fc;
            $amount = max(1, intdiv($open * mt_rand(20, 100), 100));
            $extra = mt_rand(0, 3) === 0 ? mt_rand(1, 500) : 0;     // an overpayment stays on account
            $rate = $inv->currency === 'EUR' ? $rates[mt_rand(1, 3)] : null;
            $made = $attempt(function () use ($f, $actor, $kind, $inv, $amount, $extra, $rate, $targetId) {
                $d = app(CreateSettlementDraft::class)->handle($actor, new SettlementDraftInput(
                    $f->companyId, $kind, $inv->contact_id, $f->account($inv->currency === 'EUR' ? '1200' : '1000'), new DateTimeImmutable('2026-03-2'.mt_rand(0, 8)),
                    $amount + $extra, $amount > 0 ? [new SettlementAllocationInput($amount, invoiceId: $targetId)] : [], currency: $inv->currency, fxRate: $rate,
                ));
                app(SubmitDocument::class)->handle($actor, new DocumentRef('settlement', $d->id));

                return $d->id;
            });
            if ($made !== null) {
                $settlements[$made] = $kind;
            }
        } elseif ($roll <= 82) {
            // Apply credit on account or a note to a random open document of the same contact.
            $sid = $pick($settlements);
            $target = $pick($docs['sales'] + $docs['bills']);
            if ($sid !== null && $target !== null) {
                $made = $attempt(fn () => app(ApplyCredit::class)->handle($actor, new ApplyCreditInput($target, mt_rand(1, 3000), settlementId: $sid)));
                $made !== null && $applications[] = $made->id;
            }
        } elseif ($roll <= 88) {
            $note = $pick($docs['credit'] + $docs['debit']);
            $target = $pick($docs['sales'] + $docs['bills']);
            if ($note !== null && $target !== null) {
                $made = $attempt(fn () => app(ApplyCredit::class)->handle($actor, new ApplyCreditInput($target, mt_rand(1, 3000), noteId: $note)));
                $made !== null && $applications[] = $made->id;
            }
        } elseif ($roll <= 94) {
            $sid = $pick($settlements);
            $sid !== null && $attempt(fn () => app(ReverseSettlement::class)->handle($actor, new ReverseSettlementInput($sid)));
        } elseif ($applications !== []) {
            $attempt(fn () => app(UndoCreditApplication::class)->handle($actor, $applications[mt_rand(0, count($applications) - 1)]));
        }

        expect(LedgerChecks::problems())->toBe([], "after step {$step} (seed {$seed})");
    }
    expect(DB::table('settlements')->whereIn('status', ['posted', 'reversed'])->count())->toBeGreaterThan(3);
})->with([3, 11, 29, 101]);
