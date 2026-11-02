<?php

declare(strict_types=1);

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\LedgerChecks;

/*
 * Bulk approval (doc 14 E5): one signing grant, then each document is approved on its own rules and reported on its own.
 */

beforeEach(function (): void {
    $this->setUpTrade();
    $this->workflow('invoice');
    $this->workflow('bill');
    $this->asPerson($this->owner)->postJson($this->api('approval-workflows'), [
        'document_type' => 'journal', 'name' => 'Journals', 'source' => 'any', 'min_amount' => 0, 'steps' => [['role' => 'Approver']],
    ], $this->key())->assertCreated();

    /** A submitted document waiting for an approver: [type, id]. */
    $this->pending = function (string $kind, ?object $by = null): array {
        $by ??= $this->accountant;
        [$path, $body] = match ($kind) {
            'invoice' => ['invoices', $this->t->body($this->t->customer, [[10000, '1', 'VAT10']])],
            'bill' => ['bills', $this->t->body($this->t->supplier, [[5000, '1', 'VAT10', '0', '5000']])],
            'journal' => ['journals', $this->journalBody(7000)],
        };
        $doc = $this->draftDoc($path, $body, $by);
        $this->submitDoc($path, $doc['id'], $by);

        return [$kind, $doc['id']];
    };
});

it('approves a mixed batch with one grant and reports each document', function (): void {
    $docs = [($this->pending)('invoice'), ($this->pending)('bill'), ($this->pending)('journal'), ($this->pending)('invoice')];
    $payload = array_map(fn (array $d): array => ['type' => $d[0], 'id' => $d[1]], $docs);

    $out = $this->asPerson($this->approver, signing: true)->postJson($this->api('approvals/bulk-approve'), ['documents' => $payload], $this->key())
        ->assertOk()->assertJsonPath('meta.approved', 4)->assertJsonPath('meta.skipped', 0)->json('data');

    expect(array_column($out, 'id'))->toBe(array_column($payload, 'id'), 'results come back in the order they were sent')
        ->and(array_unique(array_column($out, 'status')))->toBe(['posted'])
        ->and(array_filter(array_column($out, 'number')))->toHaveCount(4);
    $this->inTenant(function (): void {
        expect(DB::table('invoices')->where('status', 'posted')->count())->toBe(3)->and(DB::table('journals')->where('status', 'posted')->count())->toBe(4)
            ->and(DB::table('approval_requests')->where('status', 'approved')->count())->toBe(4)
            ->and(DB::table('audit_events')->whereIn('action', ['invoice.approved', 'bill.approved', 'journal.approved'])->count())->toBe(4)
            ->and(LedgerChecks::problems())->toBe([]);
    });
});

it('lets one failure stand alone: the rest are approved and the failed one is untouched', function (): void {
    $dual = $this->person('Dana Dual', ['Accountant', 'Approver']);
    $ours = ($this->pending)('invoice', $dual); // Dana is its maker, so cannot approve it
    $theirs = ($this->pending)('invoice');
    $ghost = ['invoice', (string) Str::uuid7()];
    $already = ($this->pending)('bill');
    $this->asPerson($this->approver, signing: true)->postJson($this->api("bills/{$already[1]}/approve"), [], $this->key())->assertOk();

    $docs = [$ghost, $theirs, $already, $ours];
    // Dana approves her colleague's invoice; her own is refused, a ghost is not found, a posted bill is no longer pending.
    $this->asPerson($dual, signing: true);
    $res = $this->postJson($this->api('approvals/bulk-approve'), ['documents' => array_map(fn ($d) => ['type' => $d[0], 'id' => $d[1]], $docs)], $this->key())
        ->assertOk()->assertJsonPath('meta.approved', 1)->assertJsonPath('meta.skipped', 3)->json('data');

    expect(array_column($res, 'code'))->toBe(['not_found', null, 'document_not_pending', 'self_approval_forbidden'])
        ->and(array_column($res, 'ok'))->toBe([false, true, false, false]);
    $this->inTenant(function () use ($ours, $theirs): void {
        expect(DB::table('invoices')->where('id', $ours[1])->value('status'))->toBe('pending_approval')
            ->and(DB::table('invoices')->where('id', $theirs[1])->value('status'))->toBe('posted');
    });
});

it('refuses the whole batch without a signing grant, and bad batches', function (): void {
    $d = ($this->pending)('invoice');
    $one = ['documents' => [['type' => 'invoice', 'id' => $d[1]]]];

    $this->asPerson($this->approver)->postJson($this->api('approvals/bulk-approve'), $one, $this->key())->assertForbidden()->assertJson(['code' => 'signature_required']);
    expect($this->inTenant(fn () => DB::table('invoices')->where('id', $d[1])->value('status')))->toBe('pending_approval');

    $this->asPerson($this->approver, signing: true);
    $this->postJson($this->api('approvals/bulk-approve'), ['documents' => []], $this->key())->assertStatus(422)->assertJsonValidationErrors(['documents']);
    $many = array_map(fn () => ['type' => 'invoice', 'id' => (string) Str::uuid7()], range(1, 51));
    $this->postJson($this->api('approvals/bulk-approve'), ['documents' => $many], $this->key())->assertStatus(422)->assertJsonValidationErrors(['documents']);
    $this->postJson($this->api('approvals/bulk-approve'), ['documents' => [['type' => 'widget', 'id' => $d[1]]]], $this->key())->assertStatus(422)->assertJsonValidationErrors(['documents.0.type']);

    // The same document twice is one document.
    $this->postJson($this->api('approvals/bulk-approve'), ['documents' => [...$one['documents'], ...$one['documents']]], $this->key())->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('meta.approved', 1);
});

it('replays a batch with the same Idempotency-Key without approving anything twice', function (): void {
    $docs = [($this->pending)('invoice'), ($this->pending)('invoice')];
    $body = ['documents' => array_map(fn ($d) => ['type' => $d[0], 'id' => $d[1]], $docs)];
    $key = $this->key();
    $this->asPerson($this->approver, signing: true);

    $first = $this->postJson($this->api('approvals/bulk-approve'), $body, $key)->assertOk()->json();
    $second = $this->postJson($this->api('approvals/bulk-approve'), $body, $key)->assertOk()->json();
    expect($second)->toBe($first)->and($second['meta']['approved'])->toBe(2);
    expect($this->inTenant(fn () => DB::table('audit_events')->where('action', 'invoice.approved')->count()))->toBe(2);
});

it('treats another company\'s document as missing, and keeps tokens and viewers out', function (): void {
    $beta = $this->secondCompany();
    $d = ($this->pending)('invoice');
    $viewer = $this->person('Vic Viewer', ['Viewer']);

    // Company B's route does not reach company A's document, even for someone who could approve it there.
    $this->asPerson($this->owner, signing: true);
    $other = $this->person('Beta Owner', ['Owner'], $beta->id);
    $this->asPerson($other, signing: true)->postJson($this->api('approvals/bulk-approve', $beta->id), ['documents' => [['type' => 'invoice', 'id' => $d[1]]]], $this->key())
        ->assertOk()->assertJsonPath('data.0.code', 'not_found');
    expect($this->inTenant(fn () => DB::table('invoices')->where('id', $d[1])->value('status')))->toBe('pending_approval');

    $this->asPerson($viewer, signing: true)->postJson($this->api('approvals/bulk-approve'), ['documents' => [['type' => 'invoice', 'id' => $d[1]]]], $this->key())->assertForbidden();
    $this->asToken($this->newToken(['invoices:write', 'invoices:submit']))->postJson($this->api('approvals/bulk-approve'), ['documents' => [['type' => 'invoice', 'id' => $d[1]]]], $this->key())->assertForbidden();
});
