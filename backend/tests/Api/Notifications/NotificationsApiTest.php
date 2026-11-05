<?php

declare(strict_types=1);

use App\Events\Notifications\NotificationEvent;
use App\Support\Outbox\NotificationOutboxHandler;
use App\Support\Outbox\OutboxMessage;
use App\Support\Outbox\OutboxPublisher;
use App\Support\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\LedgerFixture;

/*
 * In-app notifications (plan 3c.6): filled from outbox events, recipients by the step's role (never the maker), one row per
 * person per message, a person sees only their own, and tenants are kept apart by RLS.
 */

beforeEach(function (): void {
    $this->setUpTrade();
    $this->workflow('invoice');
    $this->approver2 = $this->person('Bea Approver', ['Approver']);
    $this->bell = fn (object $person, string $query = ''): array => $this->asPerson($person)->getJson($this->api('notifications').$query)->assertOk()->json();
    $this->submitted = function (): array {
        $doc = $this->draftDoc('invoices', $this->t->body($this->t->customer, [[10000, '1', 'VAT10']]));
        $this->submitDoc('invoices', $doc['id']);

        return $doc;
    };
});

it('tells the holders of the step role, and not the maker, that an approval is waiting', function (): void {
    $doc = ($this->submitted)();

    foreach ([$this->approver, $this->approver2] as $approver) {
        $list = ($this->bell)($approver);
        expect($list['data'])->toHaveCount(1)
            ->and($list['data'][0])->toMatchArray(['kind' => 'approval_requested', 'subject_type' => 'invoice', 'subject_id' => $doc['id'], 'link' => 'approvals', 'read' => false])
            ->and($list['meta']['unread_count'])->toBe(1);
    }
    expect(($this->bell)($this->accountant)['data'])->toBe([])->and(($this->bell)($this->owner)['data'])->toBe([]);
});

it('tells the maker when the last approval is in, and when the document is returned', function (): void {
    $first = ($this->submitted)();
    $this->asPerson($this->approver, signing: true)->postJson($this->api("invoices/{$first['id']}/approve"), [], $this->key())->assertOk();
    $second = ($this->submitted)();
    $this->asPerson($this->approver, signing: true)->postJson($this->api("invoices/{$second['id']}/return"), ['comment' => 'Wrong customer'], $this->key())->assertOk();

    $kinds = array_column(($this->bell)($this->accountant)['data'], 'kind');
    sort($kinds);
    expect($kinds)->toBe(['document_approved', 'document_returned']);
    // The approver who acted is not told about their own decision.
    expect(array_column(($this->bell)($this->approver)['data'], 'kind'))->not->toContain('document_returned');
});

it('marks one read, marks all read, filters unread, and refuses someone else\'s notification as not found', function (): void {
    ($this->submitted)();
    ($this->submitted)();
    $mine = ($this->bell)($this->approver);
    expect($mine['meta']['unread_count'])->toBe(2);

    $this->asPerson($this->approver)->postJson($this->api("notifications/{$mine['data'][0]['id']}/read"), [], $this->key())->assertOk()->assertJsonPath('data.read', true);
    expect(($this->bell)($this->approver, '?unread=1')['data'])->toHaveCount(1)->and(($this->bell)($this->approver)['meta']['unread_count'])->toBe(1);

    // Bea cannot touch Abe's notification, and her own count is unchanged.
    $this->asPerson($this->approver2)->postJson($this->api("notifications/{$mine['data'][1]['id']}/read"), [], $this->key())->assertNotFound();
    expect(($this->bell)($this->approver2)['meta']['unread_count'])->toBe(2);

    $this->asPerson($this->approver)->postJson($this->api('notifications/read-all'), [], $this->key())->assertOk()->assertJsonPath('data.marked', 1);
    expect(($this->bell)($this->approver)['meta']['unread_count'])->toBe(0)->and(($this->bell)($this->approver2)['meta']['unread_count'])->toBe(2);
});

it('does not show a person the notifications of another company they work in', function (): void {
    ($this->submitted)();
    $other = $this->secondCompany();
    $this->asPerson($this->approver)->getJson($this->api('notifications', $other->id))->assertStatus(403);
    expect(($this->bell)($this->approver)['data'])->toHaveCount(1);
});

it('stores one row per person per outbox message, however often the message is handled', function (): void {
    ($this->submitted)();
    $handler = app(NotificationOutboxHandler::class);
    $row = $this->inTenant(fn () => DB::table('outbox_messages')->where('type', 'document.submitted')->first());
    $message = new OutboxMessage($row->id, $row->tenant_id, $row->type, (array) json_decode($row->payload, true), (string) $row->occurred_at, 1);

    $before = $this->inTenant(fn () => DB::table('user_notifications')->count());
    $this->inTenant(function () use ($handler, $message): void {
        $handler->handle($message);
        $handler->handle($message);
    });

    expect($before)->toBe(2)->and($this->inTenant(fn () => DB::table('user_notifications')->count()))->toBe(2);
});

it('tells whoever asked that an export is ready, and whoever sent that a send failed', function (): void {
    $this->inTenant(function (): void {
        $publisher = app(OutboxPublisher::class);
        $publisher->publish(new NotificationEvent(NotificationEvent::REPORT_READY, ['company_id' => $this->f->companyId, 'user_id' => $this->accountant->id, 'report' => 'trial-balance', 'export_id' => 'x']));
        $publisher->publish(new NotificationEvent(NotificationEvent::SEND_FAILED, [
            'company_id' => $this->f->companyId, 'user_id' => $this->accountant->id, 'label' => 'Invoice INV-1 from Acme', 'link_type' => 'invoice', 'link_id' => (string) Str::uuid(), 'link' => 'invoices/abc',
        ]));
    });

    $got = ($this->bell)($this->accountant)['data'];
    $kinds = array_column($got, 'kind');
    sort($kinds);
    expect($kinds)->toBe(['report_ready', 'send_failed'])
        ->and(collect($got)->firstWhere('kind', 'report_ready')['link'])->toBe('reports/trial-balance');
    expect(($this->bell)($this->approver)['data'])->toBe([]);
});

it('keeps tenants apart: another tenant\'s notifications are invisible, and cannot be written into this one', function (): void {
    ($this->submitted)();
    $beta = LedgerFixture::create('USD', 'beta');
    $betaUser = (string) Str::uuid7();
    DB::table('users')->insert(['id' => $betaUser, 'name' => 'Bo', 'email' => 'bo@test.example', 'password' => 'x']);
    app(TenantContext::class)->run($beta->tenantId, function () use ($beta, $betaUser): void {
        DB::table('user_notifications')->insert([
            'id' => (string) Str::uuid7(), 'tenant_id' => $beta->tenantId, 'company_id' => $beta->companyId, 'user_id' => $betaUser,
            'kind' => 'approval_requested', 'title' => 'Beta only', 'dedupe_key' => 'k', 'created_at' => now(),
        ]);
    });

    expect($this->inTenant(fn () => DB::table('user_notifications')->pluck('title')->all()))->not->toContain('Beta only');
    expect(fn () => $this->inTenant(fn () => DB::table('user_notifications')->insert([
        'id' => (string) Str::uuid7(), 'tenant_id' => $beta->tenantId, 'company_id' => $beta->companyId, 'user_id' => $betaUser,
        'kind' => 'x', 'title' => 'Smuggled', 'dedupe_key' => 'k2', 'created_at' => now(),
    ])))->toThrow(QueryException::class);
});
