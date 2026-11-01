<?php

declare(strict_types=1);

use App\Actions\Trade\Inputs\ReverseInvoiceInput;
use App\Actions\Trade\ReverseInvoice;
use App\Actions\Workflow\ApproveDocument;
use App\Actions\Workflow\Inputs\DocumentRef;
use App\Actions\Workflow\Inputs\VoidDocumentInput;
use App\Actions\Workflow\VoidDocument;
use App\Domain\Shared\DomainRuleViolation;
use App\Models\Trade\Invoice;
use App\Support\Actor;
use App\Support\ActorType;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Tests\Support\LedgerChecks;

/*
 * The shared document state machine for invoices and bills (02 §5, 13 §10): submit, approve, return, void,
 * reverse, optimistic locking and idempotent retries, plus what the database holds a posted document to.
 */

beforeEach(function (): void {
    $this->setUpTrade();
});

it('runs an invoice through approval: submit, approve by someone else, post', function (): void {
    $this->workflow('invoice');
    $doc = $this->draftDoc('invoices', $this->t->body($this->t->customer, [[10000, '1', 'VAT10']]));

    $pending = $this->submitDoc('invoices', $doc['id']);
    expect($pending['status'])->toBe('pending_approval')->and($pending['number'])->toBeNull()->and($pending['version'])->toBe(1)->and($pending['journal_id'])->toBeNull();

    $this->asPerson($this->approver, signing: true)->getJson($this->api("invoices/{$doc['id']}"))->assertOk()->assertJsonPath('data.can.approve', true)->assertJsonPath('data.can.update', false);
    $posted = $this->postJson($this->api("invoices/{$doc['id']}/approve"), [], $this->key())->assertOk()
        ->assertJsonPath('data.status', 'posted')->assertJsonPath('data.number', 'INV-FY2026-00001')->assertJsonPath('data.approved_by', $this->approver->id)
        ->assertJsonPath('data.can.reverse', false)->json('data');
    expect($this->t->journalOf($posted['journal_id']))->toBe([
        '1100' => ['debit' => 11000, 'credit' => 0], '4000' => ['debit' => 0, 'credit' => 10000], '2100' => ['debit' => 0, 'credit' => 1000],
    ]);
    $this->inTenant(function () use ($doc) {
        expect(DB::table('audit_events')->where('action', 'invoice.posted')->where('subject_id', $doc['id'])->count())->toBe(1)
            ->and(DB::table('outbox_messages')->where('type', 'invoice.posted')->count())->toBe(1)
            ->and(DB::table('approval_requests')->where('document_type', 'invoice')->where('status', 'approved')->count())->toBe(1);
        expect(LedgerChecks::problems())->toBe([]);
    });
});

it('forbids approving your own invoice, even as an approver, and a bill needs the bills permissions', function (): void {
    $dual = $this->person('Dual Role', ['Accountant', 'Approver']);
    $this->workflow('invoice');
    $this->workflow('bill');
    $doc = $this->draftDoc('invoices', $this->t->body($this->t->customer, [[10000, '1']]), $dual);
    $this->asPerson($dual, signing: true)->postJson($this->api("invoices/{$doc['id']}/submit"), [], $this->key())->assertOk();

    $this->postJson($this->api("invoices/{$doc['id']}/approve"), [], $this->key())->assertForbidden();
    $this->getJson($this->api("invoices/{$doc['id']}"))->assertJsonPath('data.can.approve', false)->assertJsonPath('data.status', 'pending_approval');
    // The Action refuses on its own, whatever the policy said (the route is skipped by calling it directly).
    expect(fn () => $this->inTenant(fn () => app(ApproveDocument::class)->handle(
        new Actor(ActorType::User, $dual->id, $this->f->tenantId, $this->f->companyId, hasSigningGrant: true),
        new DocumentRef('invoice', $doc['id']),
    )))->toThrow(DomainRuleViolation::class, 'someone else');

    // A sales assistant may create and submit invoices, never bills.
    $this->asPerson($this->assistant)->postJson($this->api('bills'), $this->t->body($this->t->supplier, [[1000, '1', null, null, '5000']]), $this->key())->assertForbidden();
});

it('returns a pending invoice to draft with a comment, and then the maker may edit it again', function (): void {
    $this->workflow('invoice');
    $doc = $this->draftDoc('invoices', $this->t->body($this->t->customer, [[10000, '1']]));
    $this->submitDoc('invoices', $doc['id']);

    $this->asPerson($this->approver, signing: true)->postJson($this->api("invoices/{$doc['id']}/return"), [], $this->key())->assertStatus(422)->assertJsonValidationErrors(['comment']);
    $this->postJson($this->api("invoices/{$doc['id']}/return"), ['comment' => 'Wrong price'], $this->key())->assertOk()->assertJsonPath('data.status', 'draft')->assertJsonPath('data.version', 2);

    $this->asPerson($this->accountant)->putJson($this->api("invoices/{$doc['id']}"), [...$this->t->body($this->t->customer, [[12000, '1']]), 'version' => 2], $this->key())
        ->assertOk()->assertJsonPath('data.total.amount', 12000)->assertJsonPath('data.version', 3);
});

it('updates a draft with its version and answers 409 with the server version on a stale edit', function (): void {
    $doc = $this->draftDoc('invoices', $this->t->body($this->t->customer, [[10000, '1']]));
    $this->asPerson($this->accountant);

    $body = [...$this->t->body($this->t->customer, [[20000, '1', 'VAT10'], [500, '2']]), 'version' => 0];
    $this->putJson($this->api("invoices/{$doc['id']}"), $body, $this->key())->assertOk()
        ->assertJsonPath('data.version', 1)->assertJsonPath('data.total_fc.amount', 23000)->assertJsonCount(2, 'data.lines');
    $this->putJson($this->api("invoices/{$doc['id']}"), $body, $this->key())->assertStatus(409)->assertJson(['code' => 'version_conflict', 'server_version' => 1]);
    // The failed edit changed nothing: still two lines.
    $this->getJson($this->api("invoices/{$doc['id']}"))->assertJsonPath('data.version', 1)->assertJsonCount(2, 'data.lines');
    // Version is required on a replace and forbidden on create; submit refuses a stale version too.
    $this->putJson($this->api("invoices/{$doc['id']}"), $this->t->body($this->t->customer, [[1, '1']]), $this->key())->assertStatus(422)->assertJsonValidationErrors(['version']);
    $this->asPerson($this->accountant, signing: true)->postJson($this->api("invoices/{$doc['id']}/submit"), ['version' => 0], $this->key())->assertStatus(409)->assertJson(['code' => 'version_conflict']);
});

it('replays an identical request with the same Idempotency-Key without creating a second document', function (): void {
    $this->asPerson($this->accountant);
    $key = $this->key();
    $body = $this->t->body($this->t->customer, [[10000, '1']]);

    $first = $this->postJson($this->api('invoices'), $body, $key)->assertCreated()->json('data.id');
    $second = $this->postJson($this->api('invoices'), $body, $key)->assertCreated()->json('data.id');
    expect($second)->toBe($first)->and($this->inTenant(fn () => Invoice::query()->count()))->toBe(1);
    // The same key with another body is a different request.
    $this->postJson($this->api('invoices'), $this->t->body($this->t->customer, [[999, '1']]), $key)->assertStatus(422)->assertJson(['code' => 'idempotency_key_reuse']);

    // Posting twice with one key posts once and keeps one number.
    $this->asPerson($this->accountant, signing: true);
    $submitKey = $this->key();
    $this->postJson($this->api("invoices/{$first}/submit"), [], $submitKey)->assertOk()->assertJsonPath('data.number', 'INV-FY2026-00001');
    $this->postJson($this->api("invoices/{$first}/submit"), [], $submitKey)->assertOk()->assertJsonPath('data.number', 'INV-FY2026-00001');
    expect($this->inTenant(fn () => DB::table('journals')->count()))->toBe(1);
});

it('voids a draft or pending invoice, never a posted one; a sales assistant voids her own drafts only', function (): void {
    $posted = $this->postedDoc('invoices', $this->t->body($this->t->customer, [[1000, '1']]));
    $this->workflow('invoice');
    $mine = $this->draftDoc('invoices', $this->t->body($this->t->customer, [[1000, '1']]), $this->assistant);
    $theirs = $this->draftDoc('invoices', $this->t->body($this->t->customer, [[1000, '1']]), $this->accountant);
    $pending = $this->draftDoc('invoices', $this->t->body($this->t->customer, [[1000, '1']]), $this->assistant);
    $this->submitDoc('invoices', $pending['id'], $this->assistant);

    $this->asPerson($this->assistant);
    $this->getJson($this->api("invoices/{$mine['id']}"))->assertJsonPath('data.can.void', true);
    $this->getJson($this->api("invoices/{$theirs['id']}"))->assertJsonPath('data.can.void', false);
    $this->getJson($this->api("invoices/{$pending['id']}"))->assertJsonPath('data.can.void', false);
    $this->postJson($this->api("invoices/{$theirs['id']}/void"), ['reason' => 'x'], $this->key())->assertForbidden();
    $this->postJson($this->api("invoices/{$pending['id']}/void"), ['reason' => 'x'], $this->key())->assertForbidden();
    // The Action holds the same line for a caller that skipped the policy.
    expect(fn () => $this->inTenant(fn () => app(VoidDocument::class)->handle(
        new Actor(ActorType::User, $this->assistant->id, $this->f->tenantId, $this->f->companyId),
        new VoidDocumentInput(new DocumentRef('invoice', $pending['id'])),
    )))->toThrow(DomainRuleViolation::class, 'cannot void');
    $this->postJson($this->api("invoices/{$mine['id']}/void"), ['reason' => 'Duplicate'], $this->key())->assertOk()->assertJsonPath('data.status', 'void');

    // The accountant (invoices.void) voids her own pending invoice; an approver may void anyone's.
    $this->asPerson($this->approver)->postJson($this->api("invoices/{$pending['id']}/void"), [], $this->key())->assertOk()->assertJsonPath('data.status', 'void');
    $this->inTenant(fn () => expect(DB::table('approval_requests')->where('document_id', $pending['id'])->value('status'))->toBe('cancelled'));

    $this->asPerson($this->owner)->postJson($this->api("invoices/{$posted['id']}/void"), [], $this->key())->assertForbidden();
    $this->getJson($this->api("invoices/{$posted['id']}"))->assertJsonPath('data.can.void', false);
});

it('reverses a posted invoice through its journal: a mirror journal, the document reversed, nothing edited', function (): void {
    $posted = $this->postedDoc('invoices', $this->t->body($this->t->customer, [[10000, '1', 'VAT10']]));

    // The accountant may not; a person with the permission needs a signing grant; a token never.
    $this->asPerson($this->accountant, signing: true)->postJson($this->api("invoices/{$posted['id']}/reverse"), [], $this->key())->assertForbidden();
    $this->asPerson($this->owner)->postJson($this->api("invoices/{$posted['id']}/reverse"), [], $this->key())->assertStatus(403)->assertJson(['code' => 'signature_required']);
    $this->asToken($this->newToken(['*']))->postJson($this->api("invoices/{$posted['id']}/reverse"), [], $this->key())->assertForbidden();
    // Its journal belongs to the document: reversing it on its own would split the ledger from the sub-ledger.
    $this->asPerson($this->owner, signing: true)->postJson($this->api("journals/{$posted['journal_id']}/reverse"), [], $this->key())->assertStatus(422)->assertJson(['code' => 'journal_not_reversible']);

    $reversed = $this->postJson($this->api("invoices/{$posted['id']}/reverse"), [], $this->key())->assertOk()
        ->assertJsonPath('data.status', 'reversed')->assertJsonPath('data.payment_status', 'reversed')->assertJsonPath('data.version', $posted['version'] + 1)->json('data');
    expect($reversed['reversal_journal_id'])->not->toBeNull()->and($reversed['number'])->toBe($posted['number']);
    $this->inTenant(function () use ($posted, $reversed) {
        $original = DB::table('journals')->where('id', $posted['journal_id'])->first();
        $mirror = DB::table('journals')->where('id', $reversed['reversal_journal_id'])->first();
        expect($original->status)->toBe('reversed')->and($original->reversed_by_id)->toBe($mirror->id)->and($mirror->reversal_of_id)->toBe($original->id)
            ->and($mirror->journal_type)->toBe('reversal')->and((int) $mirror->total_debit)->toBe(11000);
        $net = DB::table('account_period_balances')->selectRaw('sum(debit) as d, sum(credit) as c')->first();
        expect((int) $net->d)->toBe((int) $net->c);
        expect(LedgerChecks::problems())->toBe([]);
    });

    // Once reversed, the route says no (like a reversed journal); the Action's own code is checked below.
    $this->postJson($this->api("invoices/{$posted['id']}/reverse"), [], $this->key())->assertForbidden();
    expect(fn () => $this->inTenant(fn () => app(ReverseInvoice::class)->handle($this->f->signedActor(), new ReverseInvoiceInput($posted['id']))))
        ->toThrow(DomainRuleViolation::class, 'already been reversed');
    $draft = $this->draftDoc('invoices', $this->t->body($this->t->customer, [[1000, '1']]), $this->owner);
    $this->asPerson($this->owner, signing: true)->postJson($this->api("invoices/{$draft['id']}/reverse"), [], $this->key())->assertForbidden();
});

it('refuses to reverse a document that has settlements, however little (invoice_has_settlements)', function (): void {
    $posted = $this->postedDoc('invoices', $this->t->body($this->t->customer, [[10000, '1']]));
    // Settlements arrive in 2.12; until then the sub-ledger columns are the guard. Allowed to change after posting.
    $this->inTenant(fn () => DB::table('invoices')->where('id', $posted['id'])->update(['settled_fc' => 100, 'settled' => 100]));

    $this->asPerson($this->owner, signing: true)->getJson($this->api("invoices/{$posted['id']}"))
        ->assertJsonPath('data.settled.amount', 100)->assertJsonPath('data.amount_due.amount', 9900)->assertJsonPath('data.payment_status', fn ($s) => in_array($s, ['partially_paid', 'overdue'], true));
    $this->postJson($this->api("invoices/{$posted['id']}/reverse"), [], $this->key())->assertStatus(422)->assertJson(['code' => 'invoice_has_settlements']);
    $this->inTenant(fn () => expect(DB::table('invoices')->where('id', $posted['id'])->value('status'))->toBe('posted')
        ->and(DB::table('journals')->where('id', $posted['journal_id'])->value('status'))->toBe('posted'));
});

it('holds a posted document to the database: no edits, no deleted lines, only the whitelisted columns move', function (): void {
    $posted = $this->postedDoc('invoices', $this->t->body($this->t->customer, [[10000, '1', 'VAT10']]));
    $sqlState = function (callable $fn): ?string {
        try {
            $this->inTenant($fn);
        } catch (QueryException $e) {
            return (string) $e->getCode();
        }

        return null;
    };

    expect($sqlState(fn () => DB::table('invoices')->where('id', $posted['id'])->update(['memo' => 'edited'])))->toBe('LG002')
        ->and($sqlState(fn () => DB::table('invoices')->where('id', $posted['id'])->update(['total' => 1])))->toBe('LG002')
        ->and($sqlState(fn () => DB::table('invoices')->where('id', $posted['id'])->update(['status' => 'draft'])))->toBe('LG002')
        ->and($sqlState(fn () => DB::table('invoices')->where('id', $posted['id'])->delete()))->toBe('LG002')
        ->and($sqlState(fn () => DB::table('invoice_lines')->where('invoice_id', $posted['id'])->update(['line_total_fc' => 1])))->toBe('LG001')
        ->and($sqlState(fn () => DB::table('invoice_lines')->where('invoice_id', $posted['id'])->delete()))->toBe('LG001')
        ->and($sqlState(fn () => DB::table('invoices')->where('id', $posted['id'])->update(['settled_fc' => 5, 'settled' => 5, 'updated_at' => now()])))->toBeNull()
        // Settled may never exceed the document, and a document that is not posted has nothing settled.
        ->and($sqlState(fn () => DB::table('invoices')->where('id', $posted['id'])->update(['settled_fc' => 99999, 'settled' => 99999])))->toBe('23514');
    $draft = $this->draftDoc('invoices', $this->t->body($this->t->customer, [[1000, '1']]));
    expect($sqlState(fn () => DB::table('invoices')->where('id', $draft['id'])->update(['settled' => 1])))->toBe('23514');
});

it('lists by status, contact, dates and the derived payment status', function (): void {
    $other = $this->inTenant(fn () => $this->t->contact('C2', 'customer'));
    $draft = $this->draftDoc('invoices', $this->t->body($this->t->customer, [[1000, '1']], '2026-03-01'));
    $paid = $this->postedDoc('invoices', $this->t->body($other, [[2000, '1']], '2026-03-05'));
    $open = $this->postedDoc('invoices', $this->t->body($this->t->customer, [[3000, '1']], '2026-03-10', ['due_date' => '2099-01-01']));
    $late = $this->postedDoc('invoices', $this->t->body($this->t->customer, [[4000, '1']], '2026-03-12', ['due_date' => '2026-03-14']));
    $part = $this->postedDoc('invoices', $this->t->body($this->t->customer, [[5000, '1']], '2026-03-20', ['due_date' => '2099-01-01']));
    $this->inTenant(function () use ($paid, $part): void {
        DB::table('invoices')->where('id', $paid['id'])->update(['settled_fc' => 2000, 'settled' => 2000]);
        DB::table('invoices')->where('id', $part['id'])->update(['settled_fc' => 1000, 'settled' => 1000]);
    });
    $bill = $this->postedDoc('bills', $this->t->body($this->t->supplier, [[1000, '1', null, null, '5000']]), $this->accountant);
    $this->asPerson($this->accountant);

    $ids = fn (string $query) => collect($this->getJson($this->api("invoices?{$query}"))->assertOk()->json('data'))->pluck('id')->all();
    expect($ids(''))->toBe([$part['id'], $late['id'], $open['id'], $paid['id'], $draft['id']]); // newest issue date first; bills are another list
    expect([
        'draft' => $ids('status=draft'),
        'contact' => $ids('contact_id='.$other),
        'issued between' => $ids('issued_from=2026-03-08&issued_to=2026-03-16'),
        'paid' => $ids('payment_status=paid'),
        'overdue status' => $ids('payment_status=overdue'),
        'overdue flag' => $ids('overdue=true'),
        'not overdue' => $ids('overdue=false'),
        'partial' => $ids('payment_status=partially_paid'),
        'awaiting' => $ids('payment_status=awaiting_payment'),
        'search' => $ids('search='.rawurlencode($open['number'])),
        'credit notes' => $ids('kind=credit_note'),
    ])->toBe([
        'draft' => [$draft['id']],
        'contact' => [$paid['id']],
        'issued between' => [$late['id'], $open['id']],
        'paid' => [$paid['id']],
        'overdue status' => [$late['id']],
        'overdue flag' => [$late['id']],
        'not overdue' => [$part['id'], $open['id'], $paid['id'], $draft['id']],
        'partial' => [$part['id']],
        'awaiting' => [$open['id']],
        'search' => [$open['id']],
        'credit notes' => [],
    ]);
    $page = $this->getJson($this->api('invoices?limit=2'))->assertJsonCount(2, 'data')->assertJsonPath('meta.limit', 2);
    expect($page->json('meta.next_cursor'))->not->toBeNull();
    $this->getJson($this->api('invoices?limit=2&cursor='.$page->json('meta.next_cursor')))->assertJsonPath('data.0.id', $open['id']);
    $this->getJson($this->api('invoices?payment_status=nope'))->assertStatus(422);
    $this->getJson($this->api('bills'))->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $bill['id']);
    // The paid one has nothing due; the late one is overdue in the resource too.
    $this->getJson($this->api("invoices/{$paid['id']}"))->assertJsonPath('data.payment_status', 'paid')->assertJsonPath('data.amount_due.amount', 0);
    $this->getJson($this->api("invoices/{$late['id']}"))->assertJsonPath('data.payment_status', 'overdue')->assertJsonPath('data.amount_due.amount', 4000);
});

it('shows what a contact owes and is owed from posted documents, net of credit notes and withheld tax', function (): void {
    $invoice = $this->postedDoc('invoices', $this->t->body($this->t->customer, [[10000, '1', 'VAT10']]));          // 110.00
    $this->postedDoc('invoices', $this->t->body($this->t->customer, [[2000, '1']], extra: ['kind' => 'credit_note', 'related_invoice_id' => $invoice['id']])); // -20.00
    $this->draftDoc('invoices', $this->t->body($this->t->customer, [[99999, '1']]));                                  // drafts are not owed
    $this->postedDoc('bills', $this->t->body($this->t->supplierWht, [[40000, '1', 'VAT10', null, '5000']]));         // owed 400.00 (440.00 less 40.00 WHT)

    $this->asPerson($this->accountant);
    $this->getJson($this->api("contacts/{$this->t->customer}"))->assertOk()
        ->assertJsonPath('data.balances.receivable', ['amount' => 9000, 'currency' => 'USD'])->assertJsonPath('data.balances.payable.amount', 0);
    $this->getJson($this->api("contacts/{$this->t->supplierWht}"))->assertJsonPath('data.balances.payable.amount', 40000)->assertJsonPath('data.balances.receivable.amount', 0);
    $list = $this->getJson($this->api('contacts?kind=customer'))->assertOk()->json('data');
    expect(collect($list)->firstWhere('id', $this->t->customer)['balances']['receivable']['amount'])->toBe(9000);
    // Settled amounts come off (2.12 moves them; the columns are enough here).
    $this->inTenant(fn () => DB::table('invoices')->where('id', $invoice['id'])->update(['settled_fc' => 5000, 'settled' => 5000]));
    $this->getJson($this->api("contacts/{$this->t->customer}"))->assertJsonPath('data.balances.receivable.amount', 4000);
});
