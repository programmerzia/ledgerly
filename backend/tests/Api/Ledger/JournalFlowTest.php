<?php

declare(strict_types=1);

use App\Models\Ledger\Journal;

/*
 * The journal lifecycle over HTTP (13 §10, §16): draft → preview → submit → approve (signed) → posted → reverse.
 */

beforeEach(function (): void {
    $this->setUpWorld();
    $this->accountant = $this->person('Ann Accountant', ['Accountant']);
    $this->approver = $this->person('Abe Approver', ['Approver']);
    $this->owner = $this->person('Olga Owner', ['Owner']);
});

it('runs a journal from draft through approval to posting and reversal', function (): void {
    // A workflow with one Approver step.
    $this->asPerson($this->owner)->postJson($this->api('approval-workflows'), [
        'document_type' => 'journal', 'name' => 'All journals', 'source' => 'any', 'min_amount' => 0, 'steps' => [['role' => 'Approver']],
    ], $this->key())->assertCreated()->assertJsonPath('data.steps.0.role', 'Approver');

    $draft = $this->asPerson($this->accountant)->postJson($this->api('journals'), $this->journalBody(), $this->key())
        ->assertCreated()
        ->assertJsonPath('data.status', 'draft')
        ->assertJsonPath('data.version', 0)
        ->assertJsonPath('data.lines.0.debit', ['amount' => 10000, 'currency' => 'USD'])
        ->assertJsonPath('data.lines.1.credit.amount', 10000)
        ->assertJsonPath('data.can.update', true)
        ->assertJsonPath('data.can.approve', false);
    $id = $draft->json('data.id');

    $this->postJson($this->api("journals/{$id}/posting-preview"), [], $this->key())
        ->assertOk()->assertJsonPath('data.valid', true)->assertJsonPath('data.total_debit.amount', 10000)->assertJsonPath('data.number', null);

    $submitted = $this->asPerson($this->accountant, signing: true)->postJson($this->api("journals/{$id}/submit"), ['version' => 0], $this->key())
        ->assertOk()->assertJsonPath('data.status', 'pending_approval');
    expect($submitted->json('data.version'))->toBe(1);

    // The approver sees it in the inbox; the maker does not.
    $this->asPerson($this->approver, signing: true)->getJson($this->api('approvals'))
        ->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.document.id', $id)->assertJsonPath('data.0.document.amount.amount', 10000);
    $this->asPerson($this->accountant, signing: true)->getJson($this->api('approvals'))->assertForbidden();

    $this->asPerson($this->approver, signing: true)->postJson($this->api("journals/{$id}/approve"), [], $this->key())
        ->assertOk()->assertJsonPath('data.status', 'posted')->assertJsonPath('data.can.reverse', false);
    $this->getJson($this->api("journals/{$id}"))->assertOk()->assertJsonPath('data.number', fn ($n) => is_string($n) && $n !== '')
        ->assertJsonPath('data.total_debit.amount', 10000);

    // Reversal is for Owner/Finance Manager.
    $reversal = $this->asPerson($this->owner, signing: true)->postJson($this->api("journals/{$id}/reverse"), [], $this->key())
        ->assertCreated()->assertJsonPath('data.status', 'posted')->assertJsonPath('data.reversal_of_id', $id)
        ->assertJsonPath('data.lines.0.credit.amount', 10000);
    expect($reversal->json('data.id'))->not->toBe($id);
    $this->getJson($this->api("journals/{$id}"))->assertJsonPath('data.status', 'reversed')->assertJsonPath('data.reversed_by_id', $reversal->json('data.id'));
});

it('posts a draft directly when no workflow applies and the person has signed', function (): void {
    $id = $this->asPerson($this->accountant)->postJson($this->api('journals'), $this->journalBody(), $this->key())->assertCreated()->json('data.id');

    $this->asPerson($this->accountant)->postJson($this->api("journals/{$id}/submit"), [], $this->key())
        ->assertStatus(403)->assertJson(['code' => 'signature_required']);
    $this->asPerson($this->accountant, signing: true)->postJson($this->api("journals/{$id}/submit"), [], $this->key())
        ->assertOk()->assertJsonPath('data.status', 'posted');
});

it('rejects an unbalanced journal with violation codes at preview and submit', function (): void {
    $body = $this->journalBody();
    $body['lines'][1]['credit'] = 9000;
    $id = $this->asPerson($this->accountant, signing: true)->postJson($this->api('journals'), $body, $this->key())->assertCreated()->json('data.id');

    $this->postJson($this->api("journals/{$id}/posting-preview"), [], $this->key())
        ->assertOk()->assertJsonPath('data.valid', false)->assertJsonPath('data.violations.0.code', 'journal_unbalanced');
    $this->postJson($this->api("journals/{$id}/submit"), [], $this->key())
        ->assertStatus(422)->assertJson(['code' => 'journal_unbalanced'])->assertJsonPath('violations.0.code', 'journal_unbalanced');
});

it('forbids approving your own journal, even as an approver', function (): void {
    $maker = $this->person('Dual Role', ['Accountant', 'Approver']);
    $this->asPerson($this->owner)->postJson($this->api('approval-workflows'), [
        'document_type' => 'journal', 'name' => 'All', 'source' => 'any', 'min_amount' => 0, 'steps' => [['role' => 'Approver']],
    ], $this->key())->assertCreated();

    $id = $this->asPerson($maker, signing: true)->postJson($this->api('journals'), $this->journalBody(), $this->key())->assertCreated()->json('data.id');
    $this->postJson($this->api("journals/{$id}/submit"), [], $this->key())->assertOk();
    $this->postJson($this->api("journals/{$id}/approve"), [], $this->key())->assertForbidden();
    $this->getJson($this->api("journals/{$id}"))->assertJsonPath('data.can.approve', false)->assertJsonPath('data.status', 'pending_approval');
});

it('needs the signing PIN to approve', function (): void {
    $this->asPerson($this->owner)->postJson($this->api('approval-workflows'), [
        'document_type' => 'journal', 'name' => 'All', 'source' => 'any', 'min_amount' => 0, 'steps' => [['role' => 'Approver']],
    ], $this->key())->assertCreated();
    $id = $this->asPerson($this->accountant, signing: true)->postJson($this->api('journals'), $this->journalBody(), $this->key())->json('data.id');
    $this->postJson($this->api("journals/{$id}/submit"), [], $this->key())->assertOk();

    $this->asPerson($this->approver)->postJson($this->api("journals/{$id}/approve"), [], $this->key())
        ->assertStatus(403)->assertJson(['code' => 'signature_required']);
});

it('returns a journal with a comment and lets the maker void a draft', function (): void {
    $this->asPerson($this->owner)->postJson($this->api('approval-workflows'), [
        'document_type' => 'journal', 'name' => 'All', 'source' => 'any', 'min_amount' => 0, 'steps' => [['role' => 'Approver']],
    ], $this->key())->assertCreated();
    $id = $this->asPerson($this->accountant, signing: true)->postJson($this->api('journals'), $this->journalBody(), $this->key())->json('data.id');
    $this->postJson($this->api("journals/{$id}/submit"), [], $this->key())->assertOk();

    $this->asPerson($this->approver, signing: true)->postJson($this->api("journals/{$id}/return"), [], $this->key())->assertStatus(422)->assertJsonValidationErrors(['comment']);
    $this->postJson($this->api("journals/{$id}/return"), ['comment' => 'Wrong account'], $this->key())
        ->assertOk()->assertJsonPath('data.status', 'draft');

    $this->asPerson($this->accountant)->postJson($this->api("journals/{$id}/void"), ['reason' => 'Duplicate'], $this->key())
        ->assertOk()->assertJsonPath('data.status', 'void');
});

it('updates a draft with its version and answers 409 with the server version on a stale edit', function (): void {
    $id = $this->asPerson($this->accountant)->postJson($this->api('journals'), $this->journalBody(), $this->key())->json('data.id');

    $body = [...$this->journalBody(20000), 'version' => 0];
    $this->putJson($this->api("journals/{$id}"), $body, $this->key())
        ->assertOk()->assertJsonPath('data.version', 1)->assertJsonPath('data.lines.0.debit.amount', 20000);

    $this->putJson($this->api("journals/{$id}"), $body, $this->key())
        ->assertStatus(409)->assertJson(['code' => 'version_conflict', 'server_version' => 1]);
    $this->putJson($this->api("journals/{$id}"), [...$this->journalBody(), 'version' => 1], $this->key())->assertOk();
});

it('validates draft lines as form errors scoped to the company', function (): void {
    $beta = $this->secondCompany();
    $foreign = $this->inTenant(function () use ($beta): string {
        $id = (string) Str::uuid7();
        DB::table('accounts')->insert(['id' => $id, 'tenant_id' => $this->f->tenantId, 'company_id' => $beta->id, 'code' => '1000', 'name' => 'Cash', 'account_type' => 'asset', 'normal_balance' => 'debit']);

        return $id;
    });
    $this->asPerson($this->accountant);

    $this->postJson($this->api('journals'), ['journal_date' => '2026-03-15', 'lines' => [
        ['account_id' => $foreign, 'debit' => 100],
        ['account_id' => (string) Str::uuid7(), 'credit' => 100],
        ['account_id' => $this->f->account('1000'), 'debit' => 5, 'credit' => 5],
        ['account_id' => $this->f->account('1000')],
        ['account_id' => $this->f->account('1000'), 'debit' => 5, 'currency' => 'EUR'],
        ['account_id' => $this->f->account('1000'), 'debit' => 5, 'dimensions' => [(string) Str::uuid7() => (string) Str::uuid7()]],
    ]], $this->key())->assertStatus(422)->assertJson(['code' => 'validation_failed'])
        ->assertJsonValidationErrors(['lines.0.account_id', 'lines.1.account_id']);

    $this->postJson($this->api('journals'), ['journal_date' => '03/15/2026', 'lines' => []], $this->key())
        ->assertStatus(422)->assertJsonValidationErrors(['journal_date', 'lines']);
    $this->postJson($this->api('journals'), ['journal_date' => '2026-03-15', 'lines' => [
        ['account_id' => $this->f->account('1000'), 'debit' => 5, 'credit' => 5],
        ['account_id' => $this->f->account('1000')],
        ['account_id' => $this->f->account('1000'), 'debit' => 5, 'currency' => 'EUR'],
        ['account_id' => $this->f->account('1000'), 'debit' => 5, 'dimensions' => [(string) Str::uuid7() => (string) Str::uuid7()]],
    ]], $this->key())->assertStatus(422)
        ->assertJsonValidationErrors(['lines.0.credit', 'lines.1.debit', 'lines.2.fx_rate', 'lines.3.dimensions']);
});

it('takes dimension values per line and returns them keyed by dimension', function (): void {
    $owner = $this->owner;
    $dim = $this->asPerson($owner)->postJson($this->api('dimensions'), ['code' => 'DEPT', 'name' => 'Department'], $this->key())->assertCreated()->json('data.id');
    $value = $this->postJson($this->api("dimensions/{$dim}/values"), ['code' => 'SALES', 'name' => 'Sales'], $this->key())->assertCreated()->json('data.id');

    $body = $this->journalBody();
    $body['lines'][0]['dimensions'] = [$dim => $value];
    $this->asPerson($this->accountant)->postJson($this->api('journals'), $body, $this->key())
        ->assertCreated()->assertJsonPath("data.lines.0.dimensions.{$dim}", $value);
});

it('replays an idempotent create and returns the same journal', function (): void {
    $key = $this->key();
    $first = $this->asPerson($this->accountant)->postJson($this->api('journals'), $this->journalBody(), $key)->assertCreated();
    $retry = $this->postJson($this->api('journals'), $this->journalBody(), $key)->assertCreated()->assertHeader('Idempotent-Replayed', 'true');

    expect($retry->json('data.id'))->toBe($first->json('data.id'))
        ->and($this->inTenant(fn () => Journal::query()->count()))->toBe(1);
});

it('represents a committed journal on replay when the stored response is lost', function (): void {
    $key = $this->key();
    $first = $this->asPerson($this->accountant)->postJson($this->api('journals'), $this->journalBody(), $key)->assertCreated();
    // The change committed but the response was never stored: the key is only "committed".
    $this->inTenant(fn () => DB::table('idempotency_keys')->where('key', $key['Idempotency-Key'])->update(['state' => 'committed', 'response_status' => null, 'response_body' => null]));

    $this->postJson($this->api('journals'), $this->journalBody(), $key)->assertOk()->assertHeader('Idempotent-Replayed', 'true')
        ->assertJsonPath('data.id', $first->json('data.id'))->assertJsonPath('data.lines.0.debit.amount', 10000);
});

it('lists journals with cursor pagination and filters', function (): void {
    $this->asPerson($this->accountant);
    foreach (['2026-01-10', '2026-02-10', '2026-03-10', '2026-03-10', '2026-04-10'] as $i => $date) {
        $body = $this->journalBody(1000 + $i, $date);
        $body['reference'] = "REF-{$i}";
        $this->postJson($this->api('journals'), $body, $this->key())->assertCreated();
    }

    $page1 = $this->getJson($this->api('journals?limit=2'))->assertOk()
        ->assertJsonCount(2, 'data')->assertJsonPath('meta.limit', 2)->assertJsonPath('meta.prev_cursor', null);
    expect($page1->json('data.0.journal_date'))->toBe('2026-04-10')->and($page1->json('meta.next_cursor'))->toBeString();

    $page2 = $this->getJson($this->api('journals?limit=2&cursor='.$page1->json('meta.next_cursor')))->assertOk()->assertJsonCount(2, 'data');
    expect($page2->json('meta.prev_cursor'))->toBeString();
    $page3 = $this->getJson($this->api('journals?limit=2&cursor='.$page2->json('meta.next_cursor')))->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('meta.next_cursor', null);

    $all = array_merge($page1->json('data'), $page2->json('data'), $page3->json('data'));
    expect(array_column($all, 'id'))->toHaveCount(5)->and(array_unique(array_column($all, 'id')))->toHaveCount(5);

    // Walking back from page 3 returns page 2, in the same order.
    $back = $this->getJson($this->api('journals?limit=2&cursor='.$page3->json('meta.prev_cursor')))->assertOk();
    expect($back->json('data.*.id'))->toBe($page2->json('data.*.id'))->and($back->json('meta.next_cursor'))->toBeString();

    $this->getJson($this->api('journals?from=2026-03-01&to=2026-03-31'))->assertJsonCount(2, 'data');
    $this->getJson($this->api('journals?search=ref-3'))->assertJsonCount(1, 'data')->assertJsonPath('data.0.reference', 'REF-3');
    $this->getJson($this->api('journals?status=posted'))->assertJsonCount(0, 'data');
    $this->getJson($this->api('journals?status=draft&type=manual'))->assertJsonCount(5, 'data');
    $period = $this->inTenant(fn () => $this->f->period('2026-01-15')->id);
    $this->getJson($this->api('journals?period_id='.$period))->assertJsonCount(0, 'data'); // drafts have no period yet
});

it('refuses a malformed cursor or limit with 422', function (): void {
    $this->asPerson($this->accountant);
    $this->getJson($this->api('journals?cursor=garbage'))->assertStatus(422)->assertJsonValidationErrors(['cursor']);
    $this->getJson($this->api('journals?cursor='.rtrim(strtr(base64_encode('{"d":"n","k":["not-a-date","'.Str::uuid7().'"]}'), '+/', '-_'), '=')))
        ->assertStatus(422)->assertJsonValidationErrors(['cursor']);
    $this->getJson($this->api('journals?limit=0'))->assertStatus(422)->assertJsonValidationErrors(['limit']);
    $this->getJson($this->api('journals?limit=201'))->assertStatus(422)->assertJsonValidationErrors(['limit']);
    $this->getJson($this->api('journals?limit=200'))->assertOk()->assertJsonPath('meta.limit', 200);
});

it('lets each real role do what the matrix says', function (): void {
    $viewer = $this->person('Vic Viewer', ['Viewer']);
    $this->asPerson($viewer)->getJson($this->api('journals'))->assertOk();
    $this->postJson($this->api('journals'), $this->journalBody(), $this->key())->assertForbidden();

    $nobody = $this->person('Nora Nobody', []);
    $this->asPerson($nobody)->getJson($this->api('journals'))->assertStatus(403);
    $nobody2 = $this->person('Nick Nobody', ['Accountant'], org: 'admin');
    $this->asPerson($nobody2)->getJson($this->api('journals'))->assertOk();

    // An accountant can draft and submit but neither approve nor reverse a posted journal.
    $posted = $this->asPerson($this->accountant, signing: true)->postJson($this->api('journals'), $this->journalBody(), $this->key())->json('data.id');
    $this->postJson($this->api("journals/{$posted}/submit"), [], $this->key())->assertOk()->assertJsonPath('data.status', 'posted')
        ->assertJsonPath('data.can.reverse', false);
    $this->postJson($this->api("journals/{$posted}/reverse"), [], $this->key())->assertForbidden();
    $this->asPerson($this->approver, signing: true)->postJson($this->api("journals/{$posted}/reverse"), [], $this->key())->assertForbidden();
    // The Owner may reverse, but reversing posts, so it needs the signing PIN too (ADR-0004).
    $this->asPerson($this->owner)->postJson($this->api("journals/{$posted}/reverse"), [], $this->key())
        ->assertForbidden()->assertJson(['code' => 'signature_required']);
    $this->asPerson($this->owner, signing: true)->postJson($this->api("journals/{$posted}/reverse"), [], $this->key())->assertCreated();
});

it('refuses unauthenticated callers', function (): void {
    app('auth')->forgetGuards();
    $this->withHeaders(['Accept' => 'application/json'])->getJson($this->api('journals'))->assertStatus(401);
});

it('is a 404 for an id that is not a UUID or does not exist', function (): void {
    $this->asPerson($this->owner);
    $this->getJson($this->api('journals/not-a-uuid'))->assertNotFound();
    $this->getJson($this->api('journals/'.Str::uuid7()))->assertNotFound()->assertJson(['code' => 'not_found']);
});
