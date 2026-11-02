<?php

declare(strict_types=1);

use Illuminate\Support\Facades\DB;
use Tests\Support\TamperAudit;

beforeEach(function (): void {
    $this->setUpTrade();
    $this->auditor = $this->person('Aud Itor', ['Auditor']);
    $this->viewer = $this->person('Vic Viewer', ['Viewer']);
});

it('lists the company\'s audit events newest first, filtered, with a stable cursor', function (): void {
    $invoice = $this->sale(10000);
    $this->asPerson($this->auditor);

    $all = $this->getJson($this->api('audit-events'))->assertOk()->json('data');
    expect($all)->not->toBeEmpty()->and(array_column($all, 'id'))->toBe(collect(array_column($all, 'id'))->sortDesc()->values()->all());

    $mine = $this->getJson($this->api('audit-events?subject_type=invoices&subject_id='.$invoice['id']))->assertOk()->json('data');
    expect(array_column($mine, 'action'))->toContain('invoice.created', 'invoice.submitted')->and(array_unique(array_column($mine, 'subject_id')))->toBe([$invoice['id']]);
    expect(array_column($this->getJson($this->api('audit-events?action=invoice'))->json('data'), 'action'))->each->toStartWith('invoice');
    expect($this->getJson($this->api('audit-events?action=invoice.created'))->json('data'))->toHaveCount(1);

    $page = $this->getJson($this->api('audit-events?limit=2'))->assertOk()->assertJsonCount(2, 'data')->json();
    $next = $this->getJson($this->api('audit-events?limit=2&cursor='.$page['meta']['next_cursor']))->assertOk()->json('data');
    expect($next[0]['id'])->toBeLessThan($page['data'][1]['id']);

    // Each event carries its place in the chain.
    expect($all[0]['hash'])->toHaveLength(64)->and($all[0])->toHaveKeys(['actor_type', 'actor_id', 'before', 'after', 'context', 'prev_hash', 'request_id']);
    // The person's name comes with the event (not part of the hashed record); only user actors have one.
    expect($all[0])->toHaveKey('actor_name');
    foreach ($all as $event) {
        if ($event['actor_type'] === 'user') {
            expect($event['actor_name'])->toBeString()->not->toBe('');
        } else {
            expect($event['actor_name'])->toBeNull();
        }
    }
    expect(array_filter($all, fn (array $e): bool => $e['actor_type'] === 'user'))->not->toBeEmpty();
    $this->getJson($this->api('audit-events?subject_id=nope'))->assertStatus(422)->assertJsonValidationErrors(['subject_id']);
});

it('keeps another company\'s events out of the list', function (): void {
    $beta = $this->secondCompany();
    $this->inTenant(fn () => DB::table('audit_events')->where('company_id', $this->f->companyId)->count());
    $other = $this->person('Beta Auditor', ['Auditor'], $beta->id);
    $ids = array_column($this->asPerson($other)->getJson($this->api('audit-events', $beta->id))->assertOk()->json('data'), 'subject_id');
    expect($ids)->not->toContain($this->f->companyId);
    $this->getJson($this->api('audit-events'))->assertForbidden(); // no right in company A
});

it('verifies the chain and reports tampering', function (): void {
    $this->sale(10000);
    $this->asPerson($this->auditor);

    $this->postJson($this->api('audit-events/verify'), [], $this->key())->assertOk()->assertJsonPath('data.intact', true)->assertJsonPath('data.problem', null);
    expect($this->postJson($this->api('audit-events/verify?full=true'), [], $this->key())->json('data.events_checked'))->toBeGreaterThan(5);

    TamperAudit::as($this->f->tenantId, fn ($db) => $db->table('audit_events')->where('action', 'invoice.created')->update(['action' => 'invoice.forged']));
    $this->asPerson($this->auditor)->postJson($this->api('audit-events/verify?full=true'), [], $this->key())->assertOk()->assertJsonPath('data.intact', false)->assertJsonPath('data.problem', 'canonical_mismatch');
});

it('lets only the right roles read and verify, and no tokens', function (): void {
    $this->asPerson($this->viewer)->getJson($this->api('audit-events'))->assertForbidden();
    $this->asPerson($this->accountant)->getJson($this->api('audit-events'))->assertForbidden();
    $this->asPerson($this->owner)->getJson($this->api('audit-events'))->assertOk();
    $finance = $this->person('Fin Manager', ['Finance Manager']);
    $this->asPerson($finance)->getJson($this->api('audit-events'))->assertOk();
    $this->postJson($this->api('audit-events/verify'), [], $this->key())->assertForbidden(); // Finance Manager reads, only Owner and Auditor verify
    $this->asPerson($this->owner)->postJson($this->api('audit-events/verify'), [], $this->key())->assertOk();
    $this->asToken($this->newToken(['invoices:read', 'journals:read']))->getJson($this->api('audit-events'))->assertForbidden();
});
