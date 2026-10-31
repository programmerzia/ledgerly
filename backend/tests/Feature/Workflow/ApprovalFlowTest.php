<?php

declare(strict_types=1);

use App\Actions\Organisation\AssignCompanyRole;
use App\Actions\Organisation\Inputs\CompanyRoleInput;
use App\Actions\Organisation\SeedCompanyRoles;
use App\Actions\Workflow\ApproveDocument;
use App\Actions\Workflow\Inputs\DocumentRef;
use App\Actions\Workflow\Inputs\ReturnDocumentInput;
use App\Actions\Workflow\Inputs\VoidDocumentInput;
use App\Actions\Workflow\ReturnDocument;
use App\Actions\Workflow\SubmitDocument;
use App\Actions\Workflow\VoidDocument;
use App\Domain\Ledger\DraftLine;
use App\Domain\Ledger\JournalStatus;
use App\Domain\Ledger\PostingRejected;
use App\Domain\Shared\DomainRuleViolation;
use App\Domain\Signing\Signature;
use App\Models\Ledger\Journal;
use App\Models\Workflow\ApprovalRequest;
use App\Models\Workflow\ApprovalWorkflow;
use App\Queries\Ledger\PreviewJournalPosting;
use App\Support\Actor;
use App\Support\ActorType;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\DB;
use Tests\Support\LedgerFixture;

/*
 * Submit → approve → post (13 §10): workflows by amount and source, maker ≠ checker, distinct
 * approvers, step roles, signing grants, signatures on the approval rows, return and void.
 */

/** A tenant whose owner is an Accountant (creates and submits) with seeded company roles. */
function workflowTenant(): LedgerFixture
{
    $f = LedgerFixture::create();
    app(SeedCompanyRoles::class)->handle($f->actor, $f->companyId);
    app(AssignCompanyRole::class)->handle($f->actor, new CompanyRoleInput($f->userId, $f->companyId, 'Accountant'));

    return $f;
}

/** @param list<string> $roles */
function personWith(LedgerFixture $f, string $name, array $roles, bool $grant = true): Actor
{
    $id = (string) Str::uuid7();
    DB::table('users')->insert(['id' => $id, 'name' => $name, 'email' => strtolower(str_replace(' ', '.', $name)).'@acme.test', 'password' => 'x']);
    DB::table('tenant_users')->insert(['tenant_id' => $f->tenantId, 'user_id' => $id, 'role' => 'member']);
    foreach ($roles as $role) {
        app(AssignCompanyRole::class)->handle($f->actor, new CompanyRoleInput($id, $f->companyId, $role));
    }

    return new Actor(ActorType::User, $id, $f->tenantId, $f->companyId, hasSigningGrant: $grant);
}

function signed(Actor $actor, bool $grant = true): Actor
{
    return new Actor($actor->type, $actor->id, $actor->tenantId, $actor->companyId, hasSigningGrant: $grant);
}

/** @param list<array{role: string, count?: int}> $steps */
function workflowFor(LedgerFixture $f, array $steps, int $min = 0, ?int $max = null, string $source = 'any'): ApprovalWorkflow
{
    $w = new ApprovalWorkflow;
    $w->forceFill([
        'id' => (string) Str::uuid7(), 'tenant_id' => $f->tenantId, 'company_id' => $f->companyId, 'document_type' => 'journal',
        'name' => 'Test flow', 'source' => $source, 'min_amount' => $min, 'max_amount' => $max, 'steps' => $steps, 'is_active' => true,
    ])->save();

    return $w;
}

function sale(LedgerFixture $f, int $amount = 10000, string $date = '2026-03-15'): Journal
{
    return draftJournal($f, [new DraftLine($f->account('1000'), debit: $amount), new DraftLine($f->account('4000'), credit: $amount)], $date);
}

function submitAs(Actor $actor, Journal $j): Journal
{
    $r = app(SubmitDocument::class)->handle($actor, new DocumentRef('journal', $j->id));
    expect($r)->toBeInstanceOf(Journal::class);

    return $r;
}

function approveAs(Actor $actor, Journal $j, ?string $comment = null): Journal
{
    $r = app(ApproveDocument::class)->handle($actor, new DocumentRef('journal', $j->id), $comment);
    expect($r)->toBeInstanceOf(Journal::class);

    return $r;
}

function requestsOf(Journal $j): Collection
{
    return ApprovalRequest::query()->where('document_id', $j->id)->orderBy('step')->orderBy('slot')->get();
}

function auditActions(): array
{
    return DB::table('audit_events')->orderBy('id')->pluck('action')->all();
}

it('posts at once when no workflow applies, but a person needs a signing grant', function (): void {
    $f = workflowTenant();
    $draft = sale($f);

    expect(fn () => submitAs($f->actor, $draft))->toThrow(DomainRuleViolation::class, 'signing PIN');
    expect($draft->fresh()?->status)->toBe(JournalStatus::Draft);

    $posted = submitAs(signed($f->actor), $draft);
    expect($posted->status)->toBe(JournalStatus::Posted)
        ->and($posted->number)->not->toBeNull()
        ->and($posted->submitted_by)->toBe($f->userId)
        ->and($posted->approved_by)->toBeNull()
        ->and(requestsOf($posted))->toHaveCount(0)
        ->and(auditActions())->toContain('journal.submitted', 'journal.posted');

    $submitted = DB::table('audit_events')->where('action', 'journal.submitted')->first();
    $context = json_decode((string) $submitted->context, true);
    expect($context['posted_directly'])->toBeTrue()->and($context['signature_hash'])->toHaveLength(64);
});

it('lets an API client post through submit with no PIN, and routes its documents through an api-only workflow', function (): void {
    $f = workflowTenant();
    $api = new Actor(ActorType::ApiClient, (string) Str::uuid7(), $f->tenantId, $f->companyId);

    expect(submitAs($api, sale($f))->status)->toBe(JournalStatus::Posted);

    workflowFor($f, [['role' => 'Approver']], source: 'api');
    expect(submitAs($api, sale($f))->status)->toBe(JournalStatus::PendingApproval)
        ->and(submitAs(signed($f->actor), sale($f))->status)->toBe(JournalStatus::Posted);
});

it('runs a one-step workflow: maker cannot approve, the approver needs the role and a grant, then it posts', function (): void {
    $f = workflowTenant();
    workflowFor($f, [['role' => 'Approver']], min: 5000);
    $approver = personWith($f, 'Amina Approver', ['Approver']);
    $manager = personWith($f, 'Farah Manager', ['Finance Manager']);

    expect(submitAs(signed($f->actor), sale($f, 4999))->status)->toBe(JournalStatus::Posted); // below the band

    $pending = submitAs($f->actor, sale($f, 10000));
    expect($pending->status)->toBe(JournalStatus::PendingApproval)->and($pending->lock_version)->toBe(1)
        ->and(requestsOf($pending)->pluck('status')->all())->toBe(['pending']);

    // Even a maker who may approve journals cannot approve their own (maker ≠ checker).
    app(AssignCompanyRole::class)->handle($f->actor, new CompanyRoleInput($f->userId, $f->companyId, 'Finance Manager'));
    expect(fn () => approveAs(signed($f->actor), $pending))->toThrow(DomainRuleViolation::class, 'someone else');
    expect(fn () => approveAs(signed($approver, grant: false), $pending))->toThrow(DomainRuleViolation::class, 'signing PIN');
    expect(fn () => approveAs($manager, $pending))->toThrow(DomainRuleViolation::class, 'needs a Approver');

    $posted = approveAs($approver, $pending, 'Looks right');
    $request = requestsOf($posted)->first();
    expect($posted->status)->toBe(JournalStatus::Posted)
        ->and($posted->approved_by)->toBe($approver->id)
        ->and($posted->number)->not->toBeNull()
        ->and($request->status)->toBe('approved')
        ->and($request->signed_by)->toBe($approver->id)
        ->and($request->comment)->toBe('Looks right');

    $posted->load('lines');
    $expected = Signature::hash($posted->id, Signature::contentHash($posted->documentContent()), 'posted', (string) $approver->id, $request->signed_at->utc()->format('Y-m-d\TH:i:s.u\Z'));
    expect($request->signature_hash)->toBe($expected)
        ->and(json_decode((string) DB::table('audit_events')->where('action', 'journal.approved')->value('context'), true)['signature_hash'])->toBe($expected)
        ->and(DB::table('outbox_messages')->where('type', 'document.approved')->count())->toBe(1);
});

it('needs a different person for each step', function (): void {
    $f = workflowTenant();
    workflowFor($f, [['role' => 'Approver'], ['role' => 'Finance Manager']]);
    $both = personWith($f, 'Both Roles', ['Approver', 'Finance Manager']);
    $second = personWith($f, 'Second Manager', ['Finance Manager']);

    $doc = submitAs($f->actor, sale($f));
    $afterFirst = approveAs($both, $doc);
    expect($afterFirst->status)->toBe(JournalStatus::PendingApproval)
        ->and(requestsOf($doc)->pluck('status')->all())->toBe(['approved', 'pending']);

    expect(fn () => approveAs($both, $doc))->toThrow(DomainRuleViolation::class, 'already signed');

    expect(approveAs($second, $doc)->status)->toBe(JournalStatus::Posted)
        ->and(requestsOf($doc)->pluck('signed_by')->all())->toBe([$both->id, $second->id]);
});

it('returns a pending document to draft with a comment, cancelling open steps, and allows a resubmit', function (): void {
    $f = workflowTenant();
    workflowFor($f, [['role' => 'Approver', 'count' => 2]]);
    $approver = personWith($f, 'Amina Approver', ['Approver']);
    $doc = submitAs($f->actor, sale($f));

    expect(fn () => app(ReturnDocument::class)->handle($approver, new ReturnDocumentInput(new DocumentRef('journal', $doc->id), '  ')))
        ->toThrow(DomainRuleViolation::class, 'what needs to change');

    $returned = app(ReturnDocument::class)->handle($approver, new ReturnDocumentInput(new DocumentRef('journal', $doc->id), 'Wrong account'));
    expect($returned->status)->toBe(JournalStatus::Draft)->and($returned->lock_version)->toBe(2)
        ->and(requestsOf($doc)->pluck('status')->all())->toBe(['returned', 'cancelled'])
        ->and(requestsOf($doc)->first()->comment)->toBe('Wrong account');

    expect(submitAs($f->actor, $returned)->status)->toBe(JournalStatus::PendingApproval)
        ->and(requestsOf($doc)->where('status', 'pending'))->toHaveCount(2);
});

it('voids drafts and pending documents, never posted ones', function (): void {
    $f = workflowTenant();
    workflowFor($f, [['role' => 'Approver']]);
    $approver = personWith($f, 'Amina Approver', ['Approver']);
    $other = personWith($f, 'Someone Else', ['Viewer']);

    $draft = sale($f);
    expect(fn () => app(VoidDocument::class)->handle($other, new VoidDocumentInput(new DocumentRef('journal', $draft->id))))->toThrow(DomainRuleViolation::class, 'Only the creator');
    expect(app(VoidDocument::class)->handle($f->actor, new VoidDocumentInput(new DocumentRef('journal', $draft->id), 'typo'))->status)->toBe(JournalStatus::Void);

    $pending = submitAs($f->actor, sale($f));
    expect(app(VoidDocument::class)->handle($approver, new VoidDocumentInput(new DocumentRef('journal', $pending->id)))->status)->toBe(JournalStatus::Void)
        ->and(requestsOf($pending)->pluck('status')->all())->toBe(['cancelled']);

    $posted = approveAs($approver, submitAs($f->actor, sale($f)));
    expect(fn () => app(VoidDocument::class)->handle($approver, new VoidDocumentInput(new DocumentRef('journal', $posted->id))))->toThrow(DomainRuleViolation::class, 'reverse it');
});

it('refuses to submit what cannot post, and a final approval fails if the period closed meanwhile', function (): void {
    $f = workflowTenant();
    workflowFor($f, [['role' => 'Approver']]);
    $approver = personWith($f, 'Amina Approver', ['Approver']);

    $f->setPeriodStatus('2026-02-10', 'closed');
    $closed = sale($f, date: '2026-02-10');
    expect(fn () => submitAs($f->actor, $closed))->toThrow(PostingRejected::class);
    expect($closed->fresh()?->status)->toBe(JournalStatus::Draft)->and(requestsOf($closed))->toHaveCount(0);

    $pending = submitAs($f->actor, sale($f, date: '2026-03-15'));
    $f->setPeriodStatus('2026-03-15', 'closed');
    expect(fn () => approveAs($approver, $pending))->toThrow(PostingRejected::class);
    expect($pending->fresh()?->status)->toBe(JournalStatus::PendingApproval)
        ->and(requestsOf($pending)->first()->status)->toBe('pending');
});

it('previews a posting without side effects', function (): void {
    $f = workflowTenant();
    $draft = sale($f, 12345);
    $before = [DB::table('audit_events')->count(), DB::table('outbox_messages')->count()];

    $preview = app(PreviewJournalPosting::class)->of($f->actor, $draft->id);
    expect($preview->valid)->toBeTrue()->and($preview->totalDebit)->toBe(12345)->and($preview->periodName)->not->toBeNull()
        ->and($preview->toArray()['number'])->toBeNull();

    $f->setPeriodStatus('2026-03-15', 'closed');
    $closed = app(PreviewJournalPosting::class)->of($f->actor, $draft->id);
    expect($closed->valid)->toBeFalse()->and($closed->violations[0]->code)->toBe('period_closed')
        ->and([DB::table('audit_events')->count(), DB::table('outbox_messages')->count()])->toBe($before)
        ->and($draft->fresh()?->status)->toBe(JournalStatus::Draft);
});
