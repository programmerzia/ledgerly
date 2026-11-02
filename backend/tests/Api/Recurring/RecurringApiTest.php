<?php

declare(strict_types=1);

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\LedgerChecks;

/*
 * Recurring invoices, bills and journals (doc 14 E2): schedules copy a posted template into drafts, catch up on missed
 * dates, never repeat a date, never post by themselves, and leave the maker/checker split intact.
 */

beforeEach(function (): void {
    $this->setUpTrade();
    $this->viewer = $this->person('Vic Viewer', ['Viewer']);
});

/** @return array<string, mixed> */
function scheduleBody(string $templateId, string $next = '2026-01-31', array $extra = []): array
{
    return ['name' => 'Monthly retainer', 'template_id' => $templateId, 'frequency' => 'monthly', 'next_date' => $next, ...$extra];
}

it('catches up on missed months, advances the next date and never makes a date twice', function (): void {
    $template = $this->sale(10000, '2026-01-05');
    $this->workflow('invoice');
    $balanceBefore = $this->balance('1100');

    $schedule = $this->asPerson($this->accountant)->postJson($this->api('recurring-invoices'), scheduleBody($template['id']), $this->key())
        ->assertCreated()->assertJsonPath('data.document_type', 'invoice')->assertJsonPath('data.owner_id', $this->accountant->id)
        ->assertJsonPath('data.next_date', '2026-01-31')->assertJsonPath('data.can.pause', true)->assertJsonPath('data.can.resume', false)->json('data');

    // Three dates are due by 31 March: 31 Jan, 28 Feb (month end, not a drifted day), 31 Mar.
    $run = $this->postJson($this->api('recurring-runs'), ['as_of' => '2026-03-31'], $this->key())->assertOk()->assertJsonCount(3, 'data.created')->json('data');
    expect(array_column($run['created'], 'occurrence_date'))->toBe(['2026-01-31', '2026-02-28', '2026-03-31'])
        ->and(array_unique(array_column($run['created'], 'status')))->toBe(['submitted']);

    $this->getJson($this->api("recurring-invoices/{$schedule['id']}"))->assertJsonPath('data.next_date', '2026-04-30')->assertJsonPath('data.generated_count', 3)->assertJsonPath('data.last_run_on', '2026-03-31');

    // Running again for the same date creates nothing.
    $this->postJson($this->api('recurring-runs'), ['as_of' => '2026-03-31'], $this->key())->assertOk()->assertJsonCount(0, 'data.created');
    expect($this->inTenant(fn () => DB::table('recurring_runs')->count()))->toBe(3);

    // Drafts: issue date on the occurrence, the accountant as maker, waiting for approval, copy of the template's lines.
    $docs = $this->inTenant(fn () => DB::table('invoices')->where('id', '!=', $template['id'])->orderBy('issue_date')->get());
    expect($docs->pluck('issue_date')->all())->toBe(['2026-01-31', '2026-02-28', '2026-03-31'])
        ->and($docs->pluck('status')->unique()->all())->toBe(['pending_approval'])
        ->and($docs->pluck('created_by')->unique()->all())->toBe([$this->accountant->id])
        ->and($docs->pluck('submitted_by')->unique()->all())->toBe([$this->accountant->id])
        ->and($docs->pluck('total')->unique()->all())->toBe([11000])
        ->and($docs->pluck('number')->filter()->all())->toBe([]);
    // Nothing posted by the run.
    expect($this->balance('1100'))->toBe($balanceBefore);

    // Audit shows the schedule, and who started the run.
    $audit = $this->inTenant(fn () => DB::table('audit_events')->where('action', 'recurring_schedule.occurrence_created')->orderBy('id')->get());
    expect($audit)->toHaveCount(3)->and($audit[0]->subject_id)->toBe($schedule['id'])->and(json_decode((string) $audit[0]->context, true)['occurrence_date'])->toBe('2026-01-31');
    $outbox = $this->inTenant(fn () => DB::table('outbox_messages')->where('type', 'recurring.occurrence_created')->count());
    expect($outbox)->toBe(3);

    // The maker cannot approve their own recurring draft; a different approver can, and then it posts.
    $first = $docs[0]->id;
    $this->asPerson($this->accountant, signing: true)->postJson($this->api("invoices/{$first}/approve"), [], $this->key())->assertForbidden();
    $this->asPerson($this->approver, signing: true)->postJson($this->api("invoices/{$first}/approve"), [], $this->key())->assertOk()->assertJsonPath('data.status', 'posted');
    expect($this->balance('1100'))->toBe($balanceBefore + 11000)->and($this->inTenant(fn () => LedgerChecks::problems()))->toBe([]);
});

it('keeps drafts as drafts when no workflow applies, because posting needs a person with a PIN', function (): void {
    $template = $this->sale(10000, '2026-01-05');
    $this->asPerson($this->accountant)->postJson($this->api('recurring-invoices'), scheduleBody($template['id'], '2026-02-10'), $this->key())->assertCreated();

    $run = $this->postJson($this->api('recurring-runs'), ['as_of' => '2026-02-10'], $this->key())->assertOk()->assertJsonCount(1, 'data.created')->json('data.created.0');
    expect($run['status'])->toBe('submit_failed')->and($run['note'])->toStartWith('signature_required');
    $doc = $this->inTenant(fn () => DB::table('invoices')->where('id', $run['document_id'])->first());
    expect($doc->status)->toBe('draft')->and($doc->number)->toBeNull();
});

it('recurs bills and manual journals through the same path', function (): void {
    $bill = $this->postedDoc('bills', $this->t->body($this->t->supplier, [[5000, '1', 'VAT10', '0', '5000']]));
    $this->workflow('bill');
    $journal = $this->postedDoc('journals', $this->journalBody(40000, '2026-01-01'), $this->accountant);
    $this->asPerson($this->owner)->postJson($this->api('approval-workflows'), [
        'document_type' => 'journal', 'name' => 'Journals', 'source' => 'any', 'min_amount' => 0, 'steps' => [['role' => 'Approver']],
    ], $this->key())->assertCreated();

    $this->asPerson($this->accountant)->postJson($this->api('recurring-invoices'), scheduleBody($bill['id'], '2026-02-01', ['frequency' => 'quarterly']), $this->key())
        ->assertCreated()->assertJsonPath('data.document_type', 'bill');
    $rj = $this->postJson($this->api('recurring-journals'), scheduleBody($journal['id'], '2026-02-01'), $this->key())->assertCreated()->assertJsonPath('data.document_type', 'journal')->json('data');

    $created = $this->postJson($this->api('recurring-runs'), ['as_of' => '2026-04-01'], $this->key())->assertOk()->json('data.created');
    expect(collect($created)->groupBy('document_type')->map->count()->all())->toBe(['bill' => 1, 'journal' => 3]);
    $this->inTenant(function (): void {
        expect(DB::table('journals')->where('status', 'pending_approval')->count())->toBe(3)
            ->and(DB::table('invoices')->where('kind', 'purchase_bill')->where('status', 'pending_approval')->count())->toBe(1);
    });

    // One journal schedule can be run alone (the mock's runRecurringSchedules(asOf, scheduleId)).
    $this->postJson($this->api('recurring-runs'), ['as_of' => '2026-06-01', 'schedule_id' => $rj['id']], $this->key())->assertOk()->assertJsonCount(2, 'data.created');
    $this->getJson($this->api('recurring-runs?schedule_id='.$rj['id']))->assertOk()->assertJsonCount(5, 'data');
});

it('finishes at the end date, and pauses and resumes', function (): void {
    $template = $this->sale(10000, '2026-01-05');
    $schedule = $this->asPerson($this->accountant)->postJson($this->api('recurring-invoices'), scheduleBody($template['id'], '2026-01-31', ['end_date' => '2026-02-28']), $this->key())->assertCreated()->json('data');

    $this->postJson($this->api("recurring-invoices/{$schedule['id']}/pause"), ['version' => 0], $this->key())->assertOk()->assertJsonPath('data.is_active', false)->assertJsonPath('data.version', 1);
    $this->postJson($this->api('recurring-runs'), ['as_of' => '2026-12-31'], $this->key())->assertOk()->assertJsonCount(0, 'data.created');
    $this->postJson($this->api("recurring-invoices/{$schedule['id']}/resume"), ['version' => 1], $this->key())->assertOk()->assertJsonPath('data.is_active', true);

    $this->postJson($this->api('recurring-runs'), ['as_of' => '2026-12-31'], $this->key())->assertOk()->assertJsonCount(2, 'data.created');
    $this->getJson($this->api("recurring-invoices/{$schedule['id']}"))->assertJsonPath('data.is_active', false)->assertJsonPath('data.next_date', '2026-03-31');
    $this->postJson($this->api("recurring-invoices/{$schedule['id']}/resume"), ['version' => 4], $this->key())->assertStatus(422)->assertJson(['code' => 'recurring_finished']);

    // Edit: move the end date, then it can resume.
    $this->putJson($this->api("recurring-invoices/{$schedule['id']}"), ['name' => 'Retainer', 'frequency' => 'monthly', 'next_date' => '2026-03-31', 'end_date' => '2026-05-31', 'version' => 4], $this->key())->assertOk()->assertJsonPath('data.version', 5);
    $this->putJson($this->api("recurring-invoices/{$schedule['id']}"), ['name' => 'Retainer', 'frequency' => 'monthly', 'next_date' => '2026-03-31', 'version' => 3], $this->key())->assertStatus(409)->assertJson(['code' => 'version_conflict']);
});

it('refuses unsuitable templates and owners, and people without the right', function (): void {
    $template = $this->sale(10000, '2026-01-05');
    $draft = $this->draftDoc('invoices', $this->t->body($this->t->customer, [[1000, '1', 'VAT10']]));
    $this->asPerson($this->accountant);
    $this->postJson($this->api('recurring-invoices'), scheduleBody($draft['id']), $this->key())->assertStatus(422)->assertJson(['code' => 'recurring_template_invalid']);
    $this->postJson($this->api('recurring-invoices'), scheduleBody($template['id'], '2026-03-01', ['end_date' => '2026-02-01']), $this->key())->assertStatus(422)->assertJsonValidationErrors(['end_date']);
    $this->postJson($this->api('recurring-invoices'), scheduleBody($template['id'], '2026-03-01', ['owner_id' => $this->viewer->id]), $this->key())->assertStatus(422)->assertJson(['code' => 'recurring_owner_invalid']);
    // The template is looked up inside this company only.
    $this->postJson($this->api('recurring-invoices'), scheduleBody((string) Str::uuid7()), $this->key())->assertStatus(422)->assertJsonValidationErrors(['template_id']);
    // A journal schedule cannot use an invoice, nor the other way round.
    $this->postJson($this->api('recurring-journals'), scheduleBody($template['id']), $this->key())->assertStatus(422)->assertJsonValidationErrors(['template_id']);

    $this->asPerson($this->viewer);
    $this->getJson($this->api('recurring-invoices'))->assertOk();
    $this->postJson($this->api('recurring-invoices'), scheduleBody($template['id']), $this->key())->assertForbidden();
    $this->postJson($this->api('recurring-runs'), [], $this->key())->assertForbidden();
});

it('lets a token with the ability manage and run schedules, and no other token', function (): void {
    $template = $this->sale(10000, '2026-01-05');
    $this->asToken($this->newToken(['recurring:read']))->getJson($this->api('recurring-invoices'))->assertOk();
    $this->asToken($this->newToken(['recurring:read']))->postJson($this->api('recurring-runs'), [], $this->key())->assertForbidden();
    $this->asToken($this->newToken(['invoices:write']))->getJson($this->api('recurring-invoices'))->assertForbidden();

    // A token has no person to be the maker: it names the owner.
    $token = $this->newToken(['recurring:read', 'recurring:write']);
    $this->asToken($token)->postJson($this->api('recurring-invoices'), scheduleBody($template['id'], '2026-03-01'), $this->key())->assertStatus(422)->assertJson(['code' => 'recurring_owner_required']);
    $this->asToken($token)->postJson($this->api('recurring-invoices'), scheduleBody($template['id'], '2026-03-01', ['owner_id' => $this->accountant->id]), $this->key())->assertCreated();
    $this->asToken($token)->postJson($this->api('recurring-runs'), ['as_of' => '2026-03-01'], $this->key())->assertOk()->assertJsonCount(1, 'data.created');
});

it('reports a schedule it cannot run and keeps its date, without stopping the others', function (): void {
    $template = $this->sale(10000, '2026-01-05');
    $good = $this->asPerson($this->accountant)->postJson($this->api('recurring-invoices'), scheduleBody($template['id'], '2026-02-01'), $this->key())->assertCreated()->json('data');
    $stuck = $this->postJson($this->api('recurring-invoices'), scheduleBody($template['id'], '2027-02-01'), $this->key())->assertCreated()->json('data'); // no fiscal year in 2027

    $out = $this->postJson($this->api('recurring-runs'), ['as_of' => '2027-02-01'], $this->key())->assertOk()->json('data');
    // The 2026 schedule catches up through the year; the 2027 one has no period, so its draft is kept but cannot be submitted.
    expect(count($out['created']))->toBeGreaterThan(10);
    $this->getJson($this->api("recurring-invoices/{$stuck['id']}"))->assertOk();
    $this->getJson($this->api("recurring-invoices/{$good['id']}"))->assertJsonPath('data.last_error', null);
});
