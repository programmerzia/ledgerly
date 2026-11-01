<?php

declare(strict_types=1);

use App\Actions\Trade\CreateInvoiceDraft;
use App\Actions\Trade\Inputs\InvoiceDraftInput;
use App\Actions\Trade\Inputs\InvoiceLineInput;
use App\Actions\Workflow\Inputs\DocumentRef;
use App\Actions\Workflow\SubmitDocument;
use App\Domain\Trade\InvoiceKind;
use Illuminate\Support\Facades\DB;
use Tests\Support\LedgerChecks;
use Tests\Support\LedgerFixture;
use Tests\Support\Race;
use Tests\Support\TradeFixture;

/*
 * Invoice approvals race like journal approvals (13 §8, §10): the document lock serialises them, the winner posts
 * the document, its journal and the number in one transaction, the loser re-reads and is refused. No raw errors.
 */

function pendingInvoice(LedgerFixture $f): string
{
    $t = TradeFixture::prepare($f);
    Race::workflow($f, [['role' => 'Approver', 'count' => 1]], 'invoice');
    $draft = app(CreateInvoiceDraft::class)->handle($f->actor, new InvoiceDraftInput(
        $f->companyId, InvoiceKind::SalesInvoice, $t->customer, new DateTimeImmutable('2026-03-15'),
        [new InvoiceLineInput('2', accountId: $f->account('4000'), unitPriceFc: 5000, taxCodeId: $t->tax['VAT10'], taxCodeGiven: true)],
    ));
    app(SubmitDocument::class)->handle($f->actor, new DocumentRef('invoice', $draft->id));

    return $draft->id;
}

it('posts an invoice exactly once however approvers race', function (array $racers): void {
    $this->grant('invoices.create', 'invoices.submit');
    $f = LedgerFixture::create();
    $people = ['amina' => Race::user($f, 'Amina'), 'kenneth' => Race::user($f, 'Kenneth'), 'farah' => Race::user($f, 'Farah')];
    $id = pendingInvoice($f);
    expect(DB::table('invoices')->where('id', $id)->value('status'))->toBe('pending_approval');

    $flat = Race::flatten(Race::run($f, array_map(fn (string $who) => [['op' => 'approve_invoice', 'id' => $id, 'user' => $people[$who]]], $racers)));

    $invoice = DB::table('invoices')->where('id', $id)->first();
    $approvals = DB::table('approval_requests')->where('document_id', $id)->get();
    expect(Race::errors($flat))->toBe([], 'a raw error (e.g. a deadlock) surfaced to the caller')
        ->and(Race::ok($flat))->toHaveCount(1)
        ->and(Race::refusals($flat))->each->toBe('document_not_pending')
        ->and($invoice->status)->toBe('posted')
        ->and($invoice->number)->toBe('INV-FY2026-00001')
        ->and($invoice->journal_id)->not->toBeNull()
        ->and(DB::table('journals')->where('status', 'posted')->count())->toBe(1)
        ->and(DB::table('journals')->where('id', $invoice->journal_id)->value('source_id'))->toBe($id)
        ->and(DB::table('sequences')->where('sequence_key', 'doc:sales_invoice:FY2026')->value('next_value'))->toBe(2)
        ->and(DB::table('audit_events')->where('action', 'invoice.posted')->count())->toBe(1)
        ->and(DB::table('outbox_messages')->where('type', 'invoice.posted')->count())->toBe(1)
        ->and($approvals->where('status', 'approved')->count())->toBe(1)
        ->and($approvals->where('status', 'pending')->count())->toBe(0)
        ->and(balancesByCode($f))->toBe(['1100' => ['debit' => 11000, 'credit' => 0], '2100' => ['debit' => 0, 'credit' => 1000], '4000' => ['debit' => 0, 'credit' => 10000]])
        ->and(LedgerChecks::problems())->toBe([]);
})->with([
    'two approvers' => [['amina', 'kenneth']],
    'the same approver twice' => [['amina', 'amina']],
    'three approvers' => [['amina', 'kenneth', 'farah']],
])->group('concurrency');

it('ends consistent when an approval races a void of the same invoice', function (): void {
    $this->grant('invoices.create', 'invoices.submit');
    $f = LedgerFixture::create();
    $amina = Race::user($f, 'Amina');
    $id = pendingInvoice($f);

    $flat = Race::flatten(Race::run($f, [
        [['op' => 'approve_invoice', 'id' => $id, 'user' => $amina]],
        [['op' => 'void_invoice', 'id' => $id, 'user' => $amina]],
    ]));

    $invoice = DB::table('invoices')->where('id', $id)->first();
    expect(Race::errors($flat))->toBe([])->and(Race::ok($flat))->toHaveCount(1)->and(Race::refusals($flat))->toHaveCount(1);
    if ($invoice->status === 'posted') {
        expect($invoice->journal_id)->not->toBeNull()->and($invoice->number)->toBe('INV-FY2026-00001')->and(DB::table('journals')->count())->toBe(1);
    } else {
        expect($invoice->status)->toBe('void')->and($invoice->number)->toBeNull()->and($invoice->journal_id)->toBeNull()
            ->and(DB::table('journals')->count())->toBe(0)->and(DB::table('sequences')->where('sequence_key', 'like', 'doc:%')->count())->toBe(0);
    }
    expect(LedgerChecks::problems())->toBe([]);
})->group('concurrency');

it('reverses a posted invoice once when two people race to reverse it', function (): void {
    $this->grant('invoices.create', 'invoices.submit');
    $f = LedgerFixture::create();
    $amina = Race::user($f, 'Amina');
    $kenneth = Race::user($f, 'Kenneth');
    $id = pendingInvoice($f);
    Race::run($f, [[['op' => 'approve_invoice', 'id' => $id, 'user' => $amina]]]);

    $flat = Race::flatten(Race::run($f, [
        [['op' => 'reverse_invoice', 'id' => $id, 'user' => $amina]],
        [['op' => 'reverse_invoice', 'id' => $id, 'user' => $kenneth]],
    ]));

    expect(Race::errors($flat))->toBe([])->and(Race::ok($flat))->toHaveCount(1)
        ->and(Race::refusals($flat))->toBe(['invoice_already_reversed'])
        ->and(DB::table('invoices')->where('id', $id)->value('status'))->toBe('reversed')
        ->and(DB::table('journals')->where('journal_type', 'reversal')->count())->toBe(1)
        ->and(DB::table('audit_events')->where('action', 'invoice.reversed')->count())->toBe(1)
        ->and(LedgerChecks::problems())->toBe([]);
})->group('concurrency');
