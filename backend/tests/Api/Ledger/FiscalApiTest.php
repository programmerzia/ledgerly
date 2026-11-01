<?php

declare(strict_types=1);

/*
 * Fiscal years and periods over HTTP: create, soft-close, close with the checklist and waivers, the reopen
 * request with two distinct signed approvers, year-end close and lock. Closing and reopening are for people
 * with the period permissions of the seeded roles.
 */

beforeEach(function (): void {
    $this->setUpWorld();
    $this->manager = $this->person('Fay Manager', ['Finance Manager']);
    $this->second = $this->person('Sam Second', ['Finance Manager']);
    $this->accountant = $this->person('Ann Accountant', ['Accountant']);
    $this->viewer = $this->person('Vic Viewer', ['Viewer']);
    $this->periodId = fn (string $date) => $this->inTenant(fn () => $this->f->period($date)->id);
});

it('lists fiscal years with their periods and can hints', function (): void {
    $this->asPerson($this->manager)->getJson($this->api('fiscal-years'))->assertOk()
        ->assertJsonCount(1, 'data')
        ->assertJsonPath('data.0.name', 'FY2026')
        ->assertJsonPath('data.0.starts_on', '2026-01-01')
        ->assertJsonPath('data.0.status', 'open')
        ->assertJsonCount(13, 'data.0.periods')
        ->assertJsonPath('data.0.periods.0.status', 'open')
        ->assertJsonPath('data.0.periods.0.can.soft_close', true)
        ->assertJsonPath('data.0.periods.0.can.request_reopen', false)
        ->assertJsonPath('data.0.periods.12.kind', 'adjustment')
        ->assertJsonPath('data.0.periods.0.reopen_request', null);
    $this->asPerson($this->viewer)->getJson($this->api('fiscal-years'))->assertOk()->assertJsonPath('data.0.periods.0.can.close', false);
});

it('creates a fiscal year and refuses an overlapping one', function (): void {
    $this->asPerson($this->manager)->postJson($this->api('fiscal-years'), ['name' => 'FY2027', 'starts_on' => '2027-01-01'], $this->key())
        ->assertCreated()->assertJsonPath('data.ends_on', '2027-12-31')->assertJsonCount(13, 'data.periods');
    $this->postJson($this->api('fiscal-years'), ['name' => 'FY2027b', 'starts_on' => '2027-06-01'], $this->key())->assertStatus(422)->assertJson(['code' => 'fiscal_year_overlap']);
    $this->postJson($this->api('fiscal-years'), ['name' => '', 'starts_on' => '01/01/2028'], $this->key())->assertStatus(422)->assertJsonValidationErrors(['name', 'starts_on']);
    $this->asPerson($this->accountant)->postJson($this->api('fiscal-years'), ['name' => 'FY2028', 'starts_on' => '2028-01-01'], $this->key())->assertForbidden();
});

it('soft-closes then closes a period and previews the checklist read-only', function (): void {
    $jan = ($this->periodId)('2026-01-15');
    $this->asPerson($this->accountant)->postJson($this->api('journals'), $this->journalBody(1000, '2026-01-20'), $this->key())->assertCreated();

    $this->asPerson($this->manager)->postJson($this->api("fiscal-periods/{$jan}/soft-close"), [], $this->key())
        ->assertOk()->assertJsonPath('data.status', 'soft_closed')->assertJsonPath('data.can.soft_close', false)->assertJsonPath('data.can.close', true);

    $this->getJson($this->api("fiscal-periods/{$jan}/close-checks"))->assertOk()
        ->assertJsonPath('data.0.code', 'DRAFTS')->assertJsonPath('data.0.passed', false)->assertJsonPath('data.1.code', 'APPROVALS')->assertJsonPath('data.1.passed', true);
    // The preview wrote nothing.
    expect($this->inTenant(fn () => DB::table('period_close_checks')->count()))->toBe(0);

    $this->asPerson($this->manager)->postJson($this->api("fiscal-periods/{$jan}/close"), [], $this->key())
        ->assertStatus(403)->assertJson(['code' => 'signature_required']);
    $this->asPerson($this->manager, signing: true)->postJson($this->api("fiscal-periods/{$jan}/close"), [], $this->key())
        ->assertStatus(422)->assertJson(['code' => 'period_checks_failed'])->assertJsonPath('violations.0.code', 'close_check_failed');
    $this->postJson($this->api("fiscal-periods/{$jan}/close"), ['waivers' => ['DRAFTS' => 'Opening drafts carried over']], $this->key())
        ->assertOk()->assertJsonPath('data.status', 'closed')->assertJsonPath('data.can.request_reopen', true);
    expect($this->inTenant(fn () => DB::table('period_close_checks')->where('status', 'waived')->count()))->toBe(1);

    // Posting into a closed period is refused.
    $id = $this->asPerson($this->accountant, signing: true)->postJson($this->api('journals'), $this->journalBody(1000, '2026-01-21'), $this->key())->json('data.id');
    $this->postJson($this->api("journals/{$id}/submit"), [], $this->key())->assertStatus(422)->assertJson(['code' => 'period_closed']);
});

it('keeps period changes for people with the period permissions', function (): void {
    $jan = ($this->periodId)('2026-01-15');
    $this->asPerson($this->accountant)->postJson($this->api("fiscal-periods/{$jan}/soft-close"), [], $this->key())->assertForbidden();
    $this->getJson($this->api("fiscal-periods/{$jan}/close-checks"))->assertForbidden();
    $this->asPerson($this->viewer)->postJson($this->api("fiscal-periods/{$jan}/close"), [], $this->key())->assertForbidden();
    $this->asPerson($this->manager)->postJson($this->api("fiscal-periods/{$jan}/soft-close"), [], $this->key())->assertOk();
    $this->postJson($this->api("fiscal-periods/{$jan}/soft-close"), [], $this->key())->assertForbidden(); // policy: no longer open
});

it('reopens a closed period only after two other signed approvals', function (): void {
    $jan = ($this->periodId)('2026-01-15');
    $this->asPerson($this->manager, signing: true)->postJson($this->api("fiscal-periods/{$jan}/close"), [], $this->key())->assertOk();

    $this->asPerson($this->accountant)->postJson($this->api("fiscal-periods/{$jan}/reopen-requests"), [], $this->key())->assertStatus(422)->assertJsonValidationErrors(['reason']);
    $request = $this->postJson($this->api("fiscal-periods/{$jan}/reopen-requests"), ['reason' => 'Missed an accrual'], $this->key())
        ->assertCreated()->assertJsonPath('data.status', 'pending')->assertJsonPath('data.reason', 'Missed an accrual')->assertJsonPath('data.can.approve', false);
    $rid = $request->json('data.id');
    $this->postJson($this->api("fiscal-periods/{$jan}/reopen-requests"), ['reason' => 'Again'], $this->key())->assertStatus(422)->assertJson(['code' => 'reopen_already_requested']);

    $this->asPerson($this->manager)->getJson($this->api('fiscal-years'))->assertJsonPath('data.0.periods.0.reopen_request.id', $rid)->assertJsonPath('data.0.periods.0.reopen_request.can.approve', true);

    // The requester cannot approve; the first approver cannot approve twice; no PIN, no approval.
    $this->asPerson($this->accountant, signing: true)->postJson($this->api("reopen-requests/{$rid}/approve"), [], $this->key())->assertForbidden();
    $this->asPerson($this->manager)->postJson($this->api("reopen-requests/{$rid}/approve"), [], $this->key())->assertStatus(403)->assertJson(['code' => 'signature_required']);
    $this->asPerson($this->manager, signing: true)->postJson($this->api("reopen-requests/{$rid}/approve"), [], $this->key())
        ->assertOk()->assertJsonPath('data.status', 'pending')->assertJsonPath('data.first_approver', $this->manager->id);
    $this->postJson($this->api("reopen-requests/{$rid}/approve"), [], $this->key())->assertForbidden();
    $this->asPerson($this->second, signing: true)->postJson($this->api("reopen-requests/{$rid}/approve"), [], $this->key())
        ->assertOk()->assertJsonPath('data.status', 'approved');

    $this->getJson($this->api('fiscal-years'))->assertJsonPath('data.0.periods.0.status', 'open')->assertJsonPath('data.0.periods.0.reopened_count', 1);
});

it('rejects a reopen request with a comment', function (): void {
    $jan = ($this->periodId)('2026-01-15');
    $this->asPerson($this->manager, signing: true)->postJson($this->api("fiscal-periods/{$jan}/close"), [], $this->key())->assertOk();
    $rid = $this->asPerson($this->accountant)->postJson($this->api("fiscal-periods/{$jan}/reopen-requests"), ['reason' => 'Oops'], $this->key())->json('data.id');

    $this->asPerson($this->manager, signing: true)->postJson($this->api("reopen-requests/{$rid}/reject"), [], $this->key())->assertStatus(422)->assertJsonValidationErrors(['reason', 'comment']);
    $this->postJson($this->api("reopen-requests/{$rid}/reject"), ['comment' => 'Not justified'], $this->key())
        ->assertOk()->assertJsonPath('data.status', 'rejected')->assertJsonPath('data.decision_comment', 'Not justified');
    $this->postJson($this->api("reopen-requests/{$rid}/reject"), ['comment' => 'Again'], $this->key())->assertForbidden(); // policy: decided
});

it('closes the year into retained earnings and then locks it', function (): void {
    $this->asPerson($this->accountant, signing: true)->postJson($this->api('journals'), $this->journalBody(5000, '2026-03-15'), $this->key())->assertCreated();
    $draft = $this->getJson($this->api('journals'))->json('data.0.id');
    $this->postJson($this->api("journals/{$draft}/submit"), [], $this->key())->assertOk()->assertJsonPath('data.status', 'posted');

    $year = $this->getJson($this->api('fiscal-years'))->json('data.0.id');
    $this->asPerson($this->manager, signing: true)->postJson($this->api("fiscal-years/{$year}/year-end-close"), [], $this->key())
        ->assertStatus(422)->assertJson(['code' => 'periods_not_closed']);
    $this->postJson($this->api("fiscal-years/{$year}/lock"), [], $this->key())->assertForbidden(); // policy: the year is not closed yet

    $periods = $this->getJson($this->api('fiscal-years'))->json('data.0.periods');
    foreach ($periods as $period) {
        if ($period['kind'] === 'regular') {
            $this->postJson($this->api("fiscal-periods/{$period['id']}/close"), [], $this->key())->assertOk();
        }
    }
    $closed = $this->postJson($this->api("fiscal-years/{$year}/year-end-close"), [], $this->key())
        ->assertOk()->assertJsonPath('data.status', 'closed')->assertJsonPath('meta.closing_journal_id', fn ($id) => is_string($id));
    $closing = $this->getJson($this->api('journals?type=closing'))->assertJsonCount(1, 'data')->assertJsonPath('data.0.status', 'posted')->json('data.0');
    expect($closing['journal_type'])->toBe('closing')->and($closing['id'])->toBe($closed->json('meta.closing_journal_id'));

    $this->postJson($this->api("fiscal-years/{$year}/lock"), [], $this->key())->assertStatus(422)->assertJson(['code' => 'periods_not_closed']);
    $adjustment = collect($periods)->firstWhere('kind', 'adjustment')['id'];
    $this->postJson($this->api("fiscal-periods/{$adjustment}/close"), [], $this->key())->assertOk();
    $this->postJson($this->api("fiscal-years/{$year}/lock"), [], $this->key())->assertOk()->assertJsonPath('data.status', 'locked')->assertJsonPath('data.can.lock', false);

    $this->asPerson($this->accountant)->postJson($this->api("fiscal-years/{$year}/year-end-close"), [], $this->key())->assertForbidden();
});
