<?php

declare(strict_types=1);

use App\Contracts\HtmlToPdf;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\FakePdfEngine;

/*
 * The statement run (plan 3c.7a): customers with a balance, those without an email flagged, a send per customer through the
 * normal path with a result each, and a run bigger than the hourly limit refused whole with nothing sent.
 */

beforeEach(function (): void {
    $this->setUpTrade();
    app()->instance(HtmlToPdf::class, new FakePdfEngine);
    $this->viewer = $this->person('Vic Viewer', ['Viewer']);
    $this->inTenant(fn () => DB::table('contacts')->where('id', $this->t->customer)->update(['email' => 'billing@c1.example']));
    // C2 owes money but has no email; C3 paid in full; C4 has a balance and an email.
    $this->c2 = $this->inTenant(fn () => $this->t->contact('C2', 'customer'));
    $this->c3 = $this->inTenant(fn () => $this->t->contact('C3', 'customer'));
    $this->c4 = $this->inTenant(fn () => $this->t->contact('C4', 'customer'));
    $this->inTenant(fn () => DB::table('contacts')->whereIn('id', [$this->c3, $this->c4])->update(['email' => DB::raw("lower(code) || '@x.example'")]));
    $this->sale(5000);
    $this->postedDoc('invoices', $this->t->body($this->c2, [[3000, '1', 'VAT10']]));
    $paid = $this->postedDoc('invoices', $this->t->body($this->c3, [[2000, '1', 'VAT10']]));
    $this->postedSettlement('receipt', $this->c3, 2200, [[$paid['id'], 2200]]);
    $this->postedDoc('invoices', $this->t->body($this->c4, [[1000, '1', 'VAT10']]));
    $this->mails = fn (): array => array_map(fn ($m) => $m->getOriginalMessage(), app('mailer')->getSymfonyTransport()->messages()->all());
    $this->run = fn (array $ids, array $extra = []) => $this->asPerson($this->accountant)->postJson($this->api('statement-run'), [
        'basis' => 'as_of', 'as_of' => '2026-03-31', 'contact_ids' => $ids, ...$extra,
    ], $this->key());
});

it('lists customers with a balance, flags the ones with no email, and shows the hourly allowance', function (): void {
    $out = $this->asPerson($this->accountant)->getJson($this->api('statement-run?basis=as_of&as_of=2026-03-31'))->assertOk()
        ->assertJsonPath('meta.from', '2026-01-01')->assertJsonPath('meta.to', '2026-03-31')->assertJsonPath('meta.allowance.remaining', 60)->json();
    $byName = collect($out['data'])->keyBy('name');
    expect($out['data'])->toHaveCount(3)
        ->and($byName->has('Contact C3'))->toBeFalse()
        ->and($byName['Contact C2']['has_email'])->toBeFalse()->and($byName['Contact C1']['has_email'])->toBeTrue()
        ->and($byName['Contact C1']['balance'])->toBe(['amount' => 5500, 'currency' => 'USD']);

    $this->asPerson($this->accountant)->getJson($this->api('statement-run?basis=period&from=2026-03-01&to=2026-03-10'))->assertOk()->assertJsonCount(0, 'data');
});

it('sends each selected customer\'s statement and reports a result for every one', function (): void {
    $supplier = $this->t->supplier;
    $res = ($this->run)([$this->t->customer, $this->c2, $this->c3, $supplier, (string) Str::uuid(), $this->c4])->assertOk()
        ->assertJsonPath('meta.queued', 2)->assertJsonPath('meta.not_sent', 4)->json('data');
    $by = collect($res)->keyBy('contact_id');

    expect($by[$this->t->customer])->toMatchArray(['status' => 'queued', 'code' => null])
        ->and($by[$this->c2])->toMatchArray(['status' => 'skipped', 'code' => 'no_email'])
        ->and($by[$this->c3])->toMatchArray(['status' => 'skipped', 'code' => 'no_balance'])
        ->and($by[$supplier])->toMatchArray(['status' => 'skipped', 'code' => 'not_customer'])
        ->and($by[$this->c4]['status'])->toBe('queued');
    expect(collect($res)->firstWhere('code', 'not_found'))->not->toBeNull();

    $mails = ($this->mails)();
    expect($mails)->toHaveCount(2)->and($mails[0]->getSubject())->toBe('Statement of account from Acme acme')
        ->and($mails[0]->getAttachments())->toHaveCount(1)->and($mails[0]->getAttachments()[0]->getBody())->toStartWith('%PDF');

    $ids = collect($res)->pluck('send_id')->filter()->values()->all();
    $this->asPerson($this->accountant)->getJson($this->api('statement-run/sends?'.http_build_query(['ids' => $ids])))->assertOk()
        ->assertJsonCount(2, 'data')->assertJsonPath('data.0.status', 'sent');
    $this->inTenant(fn () => expect(DB::table('document_sends')->where('document_type', 'statement')->where('status', 'sent')->count())->toBe(2)
        ->and(DB::table('audit_events')->where('action', 'document.email_queued')->count())->toBe(2));
});

it('refuses a run larger than this hour\'s allowance, whole, with the numbers, and sends nothing', function (): void {
    config(['documents.emails_per_hour' => 2]);
    $res = ($this->run)([$this->t->customer, $this->c2, $this->c4])->assertStatus(422)->assertJson(['code' => 'statement_run_over_limit']);
    expect($res->json('detail'))->toContain('You chose 3 customers, but only 2 more emails')->and($res->json('detail'))->toContain('Nothing was sent');
    expect(($this->mails)())->toBe([]);
    $this->inTenant(fn () => expect(DB::table('document_sends')->count())->toBe(0));

    // Exactly the allowance is fine, and what went out counts against the next run in the same hour.
    ($this->run)([$this->t->customer, $this->c4])->assertOk()->assertJsonPath('meta.queued', 2)->assertJsonPath('meta.allowance.remaining', 0);
    ($this->run)([$this->c2])->assertStatus(422)->assertJson(['code' => 'statement_run_over_limit']);
    $this->clock->advance('+61 minutes');
    ($this->run)([$this->c2])->assertOk();
});

it('counts mail sent by hand and by reminders toward the allowance', function (): void {
    config(['documents.emails_per_hour' => 3]);
    $doc = $this->sale(1000);
    $this->asPerson($this->accountant)->postJson($this->api("invoices/{$doc['id']}/emails"), ['recipients' => ['a@b.example']], $this->key())->assertStatus(202);
    ($this->run)([$this->t->customer, $this->c4, $this->c2])->assertStatus(422)->assertJsonPath('code', 'statement_run_over_limit');
});

it('does not send the same statement twice in a double click, and says so on that customer', function (): void {
    ($this->run)([$this->t->customer])->assertOk()->assertJsonPath('data.0.status', 'queued');
    ($this->run)([$this->t->customer])->assertOk()->assertJsonPath('data.0.status', 'failed')->assertJsonPath('data.0.code', 'already_sent');
    expect(($this->mails)())->toHaveCount(1);
});

it('needs documents.send and reports.view, validates the dates, and refuses API clients', function (): void {
    $this->asPerson($this->viewer)->getJson($this->api('statement-run?basis=as_of&as_of=2026-03-31'))->assertForbidden();
    $this->asPerson($this->viewer)->postJson($this->api('statement-run'), ['basis' => 'as_of', 'as_of' => '2026-03-31', 'contact_ids' => [$this->c4]], $this->key())->assertForbidden();
    $this->asPerson($this->accountant)->getJson($this->api('statement-run?basis=period&from=2026-04-01&to=2026-03-01'))->assertStatus(422);
    $this->asPerson($this->accountant)->getJson($this->api('statement-run?basis=as_of'))->assertStatus(422);
    ($this->run)([])->assertStatus(422);
    $token = $this->newToken(['contacts:read', 'reports:read']);
    $this->asToken($token)->getJson($this->api('statement-run?basis=as_of&as_of=2026-03-31'))->assertForbidden();
});

it('never lists or sends another company\'s customers', function (): void {
    $other = $this->secondCompany();
    $foreign = $this->inTenant(function () use ($other): string {
        $id = (string) Str::uuid7();
        DB::table('contacts')->insert(['id' => $id, 'tenant_id' => $this->f->tenantId, 'company_id' => $other->id, 'kind' => 'customer', 'code' => 'F1', 'name' => 'Foreign', 'email' => 'f@x.example', 'default_currency' => 'USD', 'payment_terms_days' => 30]);

        return $id;
    });
    $res = ($this->run)([$foreign])->assertOk()->json('data');
    expect($res[0]['status'])->toBe('failed')->and($res[0]['code'])->toBe('not_found')->and(($this->mails)())->toBe([]);
});
