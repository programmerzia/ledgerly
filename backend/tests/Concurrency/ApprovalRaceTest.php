<?php

declare(strict_types=1);

use App\Actions\Workflow\Inputs\DocumentRef;
use App\Actions\Workflow\SubmitDocument;
use App\Domain\Ledger\DraftLine;
use App\Domain\Ledger\JournalStatus;
use Illuminate\Support\Facades\DB;
use Tests\Support\LedgerChecks;
use Tests\Support\LedgerFixture;
use Tests\Support\Race;

/*
 * Approval races (13 §10): the final signature posts in the same transaction. Racing approvers
 * serialise on the document lock; the loser re-reads a posted document and is refused.
 */

dataset('approval races', [
    'two approvers, one slot' => [[['count' => 1]], ['amina', 'kenneth'], 1],
    'the same approver twice, one slot' => [[['count' => 1]], ['amina', 'amina'], 1],
    'three approvers, two slots' => [[['count' => 2]], ['amina', 'kenneth', 'farah'], 2],
    'two approvers racing the final slot of two steps' => [[['count' => 1], ['count' => 1]], ['amina', 'kenneth'], 2],
]);

it('posts exactly once however approvers race', function (array $steps, array $racers, int $expectedApprovals): void {
    $this->grant('journals.submit');
    $f = LedgerFixture::create();
    $people = ['amina' => Race::user($f, 'Amina'), 'kenneth' => Race::user($f, 'Kenneth'), 'farah' => Race::user($f, 'Farah')];
    Race::workflow($f, array_map(fn (array $s) => ['role' => 'Approver', ...$s], $steps));

    $draft = draftJournal($f, [new DraftLine($f->account('1000'), debit: 12345), new DraftLine($f->account('4000'), credit: 12345)]);
    app(SubmitDocument::class)->handle($f->actor, new DocumentRef('journal', $draft->id));
    expect($draft->fresh()?->status)->toBe(JournalStatus::PendingApproval);

    // Two steps: the first step is signed up front so the racers fight over the final slot.
    $workers = array_map(fn (string $who) => [['op' => 'approve', 'id' => $draft->id, 'user' => $people[$who]]], $racers);
    if (count($steps) === 2) {
        Race::run($f, [[['op' => 'approve', 'id' => $draft->id, 'user' => $people['farah']]]]);
        $workers = array_map(fn (string $who) => [['op' => 'approve', 'id' => $draft->id, 'user' => $people[$who]]], ['amina', 'kenneth']);
    }

    $flat = Race::flatten(Race::run($f, $workers));
    $ok = Race::ok($flat);

    $journal = DB::table('journals')->where('id', $draft->id)->first();
    $approvals = DB::table('approval_requests')->where('document_id', $draft->id)->orderBy('step')->orderBy('slot')->get();
    $signers = $approvals->where('status', 'approved')->pluck('signed_by')->all();
    expect(Race::errors($flat))->toBe([], 'a raw error (e.g. a deadlock) surfaced to the caller')
        ->and(Race::refusals($flat))->each->toBe('document_not_pending')
        ->and($journal->status)->toBe('posted')
        ->and($journal->number)->toBe('JV-FY2026-00001')
        ->and(DB::table('journals')->where('status', 'posted')->count())->toBe(1)
        ->and(DB::table('audit_events')->where('action', 'journal.posted')->count())->toBe(1)
        ->and(DB::table('outbox_messages')->where('type', 'journal.posted')->count())->toBe(1)
        ->and($approvals->where('status', 'pending')->count())->toBe(0)
        ->and($approvals->where('status', 'approved')->count())->toBe($expectedApprovals)
        ->and(array_unique($signers))->toHaveCount($expectedApprovals)
        ->and(count($ok))->toBe(count($steps) === 2 ? 1 : $expectedApprovals)
        ->and(balancesByCode($f))->toBe(['1000' => ['debit' => 12345, 'credit' => 0], '4000' => ['debit' => 0, 'credit' => 12345]])
        ->and(LedgerChecks::problems())->toBe([]);
})->with('approval races')->group('concurrency');

it('never lets one approver take two slots of a step, however fast they click', function (): void {
    $this->grant('journals.submit');
    $f = LedgerFixture::create();
    $amina = Race::user($f, 'Amina');
    Race::workflow($f, [['role' => 'Approver', 'count' => 2]]);
    $draft = draftJournal($f, [new DraftLine($f->account('1000'), debit: 500), new DraftLine($f->account('4000'), credit: 500)]);
    app(SubmitDocument::class)->handle($f->actor, new DocumentRef('journal', $draft->id));

    $flat = Race::flatten(Race::run($f, array_fill(0, 3, [['op' => 'approve', 'id' => $draft->id, 'user' => $amina]])));

    expect(Race::errors($flat))->toBe([])
        ->and(Race::ok($flat))->toHaveCount(1)
        ->and(Race::refusals($flat))->toBe(['approver_already_signed', 'approver_already_signed'])
        ->and(DB::table('approval_requests')->where('document_id', $draft->id)->orderBy('slot')->pluck('status')->all())->toBe(['approved', 'pending'])
        ->and(DB::table('journals')->where('id', $draft->id)->value('status'))->toBe('pending_approval')
        ->and(DB::table('journals')->whereNotNull('number')->count())->toBe(0)
        ->and(LedgerChecks::problems())->toBe([]);
})->group('concurrency');
