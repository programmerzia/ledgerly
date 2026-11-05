<?php

declare(strict_types=1);

use App\Contracts\HtmlToPdf;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Symfony\Component\Mime\Email;
use Tests\Support\FakePdfEngine;

/*
 * Overdue-invoice reminders (plan 3c.7): off by default, stages in days after the due date, a daily run through
 * tenants_due_for, only posted invoices with an open balance, one send per invoice per stage (unique in the database),
 * the company's own date, an opt-out per contact, and a preview of what is due tomorrow.
 */

beforeEach(function (): void {
    $this->setUpTrade();
    app()->instance(HtmlToPdf::class, new FakePdfEngine);
    $this->inTenant(fn () => DB::table('contacts')->where('id', $this->t->customer)->update(['email' => 'billing@c1.example']));
    $this->setDunning = fn (bool $on = true, array $days = [7, 14]) => $this->asPerson($this->owner)->putJson($this->api('dunning'), [
        'enabled' => $on,
        'stages' => array_map(fn (int $d): array => ['days_after_due' => $d, 'subject' => "Overdue {$d}: invoice {{document_number}}", 'body' => 'Dear {{contact_name}}, it is {{ days_overdue }} days overdue ({{amount_due}}).'], $days),
    ], $this->key());
    /** @var list<Email> */
    $this->mails = fn (): array => array_map(fn ($m) => $m->getOriginalMessage(), app('mailer')->getSymfonyTransport()->messages()->all());
    $this->run = function (): void {
        $this->artisan('dunning:run')->assertExitCode(0);
    };
    // The invoice is issued 2026-03-15 on 30-day terms: due 2026-04-14.
    $this->at = fn (string $date) => $this->clock->advance('+'.((int) ((strtotime($date.' 09:30:00 UTC') - $this->clock->now()->getTimestamp()) / 86400)).' days');
});

it('is off by default and sends nothing until a company switches it on', function (): void {
    $this->asPerson($this->owner)->getJson($this->api('dunning'))->assertOk()->assertJsonPath('data.enabled', false)->assertJsonPath('data.stages', []);
    $this->sale(5000);
    ($this->at)('2026-04-21');
    ($this->run)();
    expect(($this->mails)())->toBe([]);
    ($this->setDunning)(true)->assertOk()->assertJsonPath('data.enabled', true)->assertJsonCount(2, 'data.stages');
    ($this->run)();
    expect(($this->mails)())->toHaveCount(1);
});

it('sends the stage once, through the normal send path with its PDF and log, and never again for that stage', function (): void {
    $doc = $this->sale(5000);
    ($this->setDunning)()->assertOk();
    ($this->at)('2026-04-21');

    ($this->run)();
    ($this->run)();
    $this->artisan('dunning:run');

    $mails = ($this->mails)();
    expect($mails)->toHaveCount(1)
        ->and($mails[0]->getSubject())->toBe("Overdue 7: invoice {$doc['number']}")
        ->and($mails[0]->getTextBody())->toContain('it is 7 days overdue (USD 55.00)')
        ->and($mails[0]->getAttachments())->toHaveCount(1);
    $this->inTenant(function () use ($doc): void {
        expect(DB::table('dunning_sends')->count())->toBe(1)
            ->and(DB::table('document_sends')->where('document_id', $doc['id'])->where('status', 'sent')->whereNull('queued_by')->count())->toBe(1)
            ->and(DB::table('dunning_sends')->whereNotNull('document_send_id')->count())->toBe(1)
            ->and(DB::table('audit_events')->where('action', 'invoice.reminder_queued')->count())->toBe(1);
    });

    // The database refuses a second claim for the same invoice and stage, whatever the application does.
    expect(fn () => $this->inTenant(fn () => DB::table('dunning_sends')->insert([
        'id' => (string) Str::uuid7(), 'tenant_id' => $this->f->tenantId, 'company_id' => $this->f->companyId,
        'invoice_id' => $doc['id'], 'stage_id' => DB::table('dunning_stages')->where('days_after_due', 7)->value('id'), 'sent_on' => '2026-04-21', 'created_at' => now(),
    ])))->toThrow(QueryException::class);

    // The next stage goes out on its own day, and the first is not repeated.
    ($this->at)('2026-04-28');
    ($this->run)();
    $mails = ($this->mails)();
    expect($mails)->toHaveCount(2)->and($mails[1]->getSubject())->toBe("Overdue 14: invoice {$doc['number']}");
});

it('does not back-fill stages whose moment passed, so switching it on does not mail every old invoice', function (): void {
    $this->sale(5000);
    ($this->setDunning)()->assertOk();
    ($this->at)('2026-05-20');
    ($this->run)();
    expect(($this->mails)())->toBe([]);
});

it('forgives a short outage: a stage is still sent up to three days late', function (): void {
    $this->sale(5000);
    ($this->setDunning)()->assertOk();
    ($this->at)('2026-04-24');
    ($this->run)();
    expect(($this->mails)())->toHaveCount(1);
});

it('skips what should not be chased: drafts, paid, reversed, credit notes, opted-out and contacts with no email', function (): void {
    $paid = $this->sale(5000);
    $this->postedSettlement('receipt', $this->t->customer, 5500, [[$paid['id'], 5500]]);
    $reversed = $this->sale(5000);
    $this->asPerson($this->owner, signing: true)->postJson($this->api("invoices/{$reversed['id']}/reverse"), ['reason' => 'Wrong', 'date' => '2026-03-20'], $this->key())->assertOk();
    $this->draftDoc('invoices', $this->t->body($this->t->customer, [[1000, '1', 'VAT10']]));
    $optOut = $this->inTenant(fn () => $this->t->contact('C2', 'customer'));
    $this->inTenant(fn () => DB::table('contacts')->where('id', $optOut)->update(['email' => 'optout@c2.example']));
    $this->inTenant(fn () => DB::table('contacts')->where('id', $optOut)->update(['dunning_opt_out' => true]));
    $this->postedDoc('invoices', $this->t->body($optOut, [[3000, '1', 'VAT10']]));
    $noEmail = $this->inTenant(fn () => $this->t->contact('C3', 'customer'));
    $this->postedDoc('invoices', $this->t->body($noEmail, [[4000, '1', 'VAT10']]));

    ($this->setDunning)()->assertOk();
    ($this->at)('2026-04-21');
    $this->asPerson($this->accountant)->getJson($this->api('dunning/preview?date=2026-04-21'))->assertOk()
        ->assertJsonCount(1, 'data')->assertJsonPath('data.0.will_send', false)->assertJsonPath('data.0.contact_name', fn ($n) => $n !== null);
    ($this->run)();

    expect(($this->mails)())->toBe([]);
    $this->inTenant(fn () => expect(DB::table('dunning_sends')->count())->toBe(0));
});

it('previews what is due tomorrow by the company\'s own calendar and flags a contact with no email', function (): void {
    $doc = $this->sale(5000);
    $noEmail = $this->inTenant(fn () => $this->t->contact('C3', 'customer'));
    $this->postedDoc('invoices', $this->t->body($noEmail, [[4000, '1', 'VAT10']]));
    ($this->setDunning)()->assertOk();
    ($this->at)('2026-04-20');

    $rows = $this->asPerson($this->owner)->getJson($this->api('dunning/preview'))->assertOk()->assertJsonPath('meta.date', '2026-04-21')->json('data');
    expect($rows)->toHaveCount(2);
    $mine = collect($rows)->firstWhere('invoice_id', $doc['id']);
    expect($mine)->toMatchArray(['stage_days' => 7, 'days_overdue' => 7, 'will_send' => true, 'email' => 'billing@c1.example'])
        ->and(collect($rows)->where('will_send', false))->toHaveCount(1);
});

it('uses the company timezone to decide the date', function (): void {
    $this->sale(5000);
    ($this->setDunning)()->assertOk();
    // 2026-04-20 21:30 UTC is already 2026-04-21 in Auckland (UTC+12): seven days after the due date there, six in UTC.
    $this->clock->advance('+36 days 12 hours');
    ($this->run)();
    expect(($this->mails)())->toBe([]);
    $this->inTenant(fn () => DB::table('companies')->where('id', $this->f->companyId)->update(['timezone' => 'Pacific/Auckland']));
    ($this->run)();
    expect(($this->mails)())->toHaveCount(1);
});

it('keeps companies apart: another company\'s invoices are not sent by this one\'s settings', function (): void {
    $other = $this->secondCompany();
    $this->sale(5000);
    ($this->setDunning)()->assertOk();
    ($this->at)('2026-04-21');
    ($this->run)();
    expect(($this->mails)())->toHaveCount(1);
    // Company B has its own (empty, off) settings: the first company's stages are not shared, and nothing was sent for B.
    $this->inTenant(fn () => expect(DB::table('dunning_stages')->where('company_id', $other->id)->count())->toBe(0)
        ->and(DB::table('dunning_sends')->where('company_id', $other->id)->count())->toBe(0));
});

it('validates the stages and needs settings.manage', function (): void {
    $stage = fn (int $d, string $body = 'Hello'): array => ['days_after_due' => $d, 'subject' => 'S', 'body' => $body];
    $this->asPerson($this->owner);
    $put = fn (array $stages, bool $on = true) => $this->putJson($this->api('dunning'), ['enabled' => $on, 'stages' => $stages], $this->key());
    $put([$stage(7), $stage(7)])->assertStatus(422)->assertJson(['code' => 'dunning_days_duplicate']);
    $put([$stage(7, 'Pay {{ secret }}')])->assertStatus(422)->assertJson(['code' => 'dunning_placeholder_unknown']);
    $put([], true)->assertStatus(422)->assertJson(['code' => 'dunning_stages_required']);
    $put([$stage(0)])->assertStatus(422)->assertJsonValidationErrors(['stages.0.days_after_due']);
    $put([$stage(7)], false)->assertOk();

    $this->asPerson($this->accountant)->putJson($this->api('dunning'), ['enabled' => true, 'stages' => [$stage(7)]], $this->key())->assertForbidden();
    $token = $this->newToken(['invoices:read']);
    $this->asToken($token)->getJson($this->api('dunning'))->assertForbidden();
});

it('will not remove a stage that has already been used', function (): void {
    $this->sale(5000);
    ($this->setDunning)()->assertOk();
    ($this->at)('2026-04-21');
    ($this->run)();
    $stages = $this->asPerson($this->owner)->getJson($this->api('dunning'))->json('data.stages');
    expect($stages[0]['sent_count'])->toBe(1);
    $this->asPerson($this->owner)->putJson($this->api('dunning'), ['enabled' => true, 'stages' => [$stages[1]]], $this->key())
        ->assertStatus(422)->assertJson(['code' => 'dunning_stage_used']);
});
