<?php

declare(strict_types=1);

use Illuminate\Support\Facades\DB;

/*
 * Approval SLA reminders (plan 3c.7): a workflow may say "remind after N hours"; the hourly run reminds the current step's
 * approvers once per interval, in the bell and by email, and two runs never remind twice for the same interval.
 */

beforeEach(function (): void {
    $this->setUpTrade();
    $this->asPerson($this->owner)->postJson($this->api('approval-workflows'), [
        'document_type' => 'invoice', 'name' => 'Invoices', 'source' => 'any', 'min_amount' => 0, 'steps' => [['role' => 'Approver']], 'remind_after_hours' => 4,
    ], $this->key())->assertCreated()->assertJsonPath('data.remind_after_hours', 4);
    $this->approver2 = $this->person('Bea Approver', ['Approver']);
    $this->doc = $this->draftDoc('invoices', $this->t->body($this->t->customer, [[10000, '1', 'VAT10']]));
    $this->submitDoc('invoices', $this->doc['id']);
    $this->remind = fn () => $this->artisan('approvals:remind')->assertExitCode(0);
    $this->mails = fn (): array => array_map(fn ($m) => $m->getOriginalMessage(), app('mailer')->getSymfonyTransport()->messages()->all());
    $this->reminders = fn () => $this->inTenant(fn () => DB::table('user_notifications')->where('kind', 'approval_reminder')->count());
});

it('sends nothing before the interval has passed', function (): void {
    $this->clock->advance('+3 hours');
    ($this->remind)();
    expect(($this->mails)())->toBe([])->and(($this->reminders)())->toBe(0);
});

it('reminds the approvers, not the maker, in the bell and by email, once per interval', function (): void {
    $this->clock->advance('+5 hours');
    ($this->remind)();
    ($this->remind)();
    ($this->remind)();

    $to = array_map(fn ($m) => $m->getTo()[0]->getAddress(), ($this->mails)());
    sort($to);
    expect($to)->toHaveCount(2)->and($to[0])->toContain('abe.approver')->and($to[1])->toContain('bea.approver')
        ->and(($this->mails)()[0]->getSubject())->toContain('is waiting for your approval')
        ->and(($this->reminders)())->toBe(2);
    $this->asPerson($this->approver)->getJson($this->api('notifications'))->assertOk()->assertJsonCount(2, 'data');
    $this->asPerson($this->accountant)->getJson($this->api('notifications'))->assertOk()->assertJsonCount(0, 'data');
    $this->inTenant(fn () => expect(DB::table('approval_reminders')->count())->toBe(1)->and(DB::table('audit_events')->where('action', 'approval.reminded')->count())->toBe(1));

    // The next interval is a new reminder; a run that was missed for two intervals sends one, not two.
    $this->clock->advance('+4 hours');
    ($this->remind)();
    expect(($this->mails)())->toHaveCount(4);
    $this->clock->advance('+8 hours');
    ($this->remind)();
    expect(($this->mails)())->toHaveCount(6);
    $this->inTenant(fn () => expect(DB::table('approval_reminders')->count())->toBe(3));
});

it('stops once the document is approved', function (): void {
    $this->asPerson($this->approver, signing: true)->postJson($this->api("invoices/{$this->doc['id']}/approve"), [], $this->key())->assertOk();
    $this->clock->advance('+30 hours');
    ($this->remind)();
    expect(($this->mails)())->toBe([])->and(($this->reminders)())->toBe(0);
});

it('does nothing for a workflow with no reminder time', function (): void {
    $this->inTenant(fn () => DB::table('approval_workflows')->update(['remind_after_hours' => null]));
    $this->clock->advance('+30 hours');
    ($this->remind)();
    expect(($this->mails)())->toBe([]);
});

it('validates the reminder time', function (): void {
    $this->asPerson($this->owner)->postJson($this->api('approval-workflows'), [
        'document_type' => 'bill', 'name' => 'Bills', 'source' => 'any', 'min_amount' => 0, 'steps' => [['role' => 'Approver']], 'remind_after_hours' => 0,
    ], $this->key())->assertStatus(422)->assertJsonValidationErrors(['remind_after_hours']);
});
