<?php

declare(strict_types=1);

namespace App\Services\Workflow;

use App\Actions\Ledger\Inputs\PostJournalInput;
use App\Actions\Ledger\PostJournal;
use App\Actions\Trade\PostInvoice;
use App\Actions\Workflow\Inputs\DocumentRef;
use App\Contracts\PermissionChecker;
use App\Contracts\Postable;
use App\Domain\Shared\DomainRuleViolation;
use App\Domain\Shared\Violation;
use App\Domain\Trade\InvoiceKind;
use App\Domain\Workflow\DocumentStatus;
use App\Models\Ledger\Journal;
use App\Models\Trade\Invoice;
use App\Queries\Ledger\PreviewJournalPosting;
use App\Queries\Trade\PreviewInvoicePosting;
use App\Services\Ledger\PostingEngine;
use App\Support\Actor;
use App\Support\UnitOfWork\LockSet;
use DateTimeImmutable;
use Illuminate\Contracts\Container\Container;
use Illuminate\Database\Eloquent\Model;

/**
 * The per-type knowledge the workflow Actions need (13 §10): how to find a document, lock it in
 * the global order (its period first, then the row), check it would post, and post it. Each Postable type
 * registers here. `invoice` covers invoices and credit notes, `bill` bills and debit notes (permissions
 * `invoices.*` and `bills.*`).
 */
final class Documents
{
    public const array TYPES = ['journal', 'invoice', 'bill'];

    public function __construct(
        private readonly Container $container,
        private readonly PostingEngine $engine,
        private readonly PermissionChecker $permissions,
    ) {}

    /** Unlocked read. */
    public function find(DocumentRef $ref): Postable&Model
    {
        $doc = match ($ref->type) {
            'journal' => Journal::query()->with('lines')->find($ref->id),
            'invoice' => Invoice::query()->with('lines')->whereIn('kind', InvoiceKind::values(...InvoiceKind::sales()))->find($ref->id),
            'bill' => Invoice::query()->with('lines')->whereIn('kind', InvoiceKind::values(...InvoiceKind::purchases()))->find($ref->id),
            default => throw DomainRuleViolation::single('document_type_unknown', "Unknown document type {$ref->type}."),
        };
        if ($doc === null) {
            throw DomainRuleViolation::single('not_found', 'The document does not exist.');
        }

        return $doc;
    }

    /** Level 1 (the document's period) then level 2 (the row, FOR UPDATE, lock_version checked). */
    public function lock(LockSet $locks, Postable&Model $doc, ?int $expectedVersion): Postable&Model
    {
        if ($doc instanceof Journal) {
            $this->engine->lockPeriod($locks, $doc->company_id, $doc->journal_type, $doc->journal_date, $doc->fiscal_period_id);
        }
        if ($doc instanceof Invoice) {
            $this->engine->lockPeriod($locks, $doc->company_id, $doc->kind->journalType(), DateTimeImmutable::createFromInterface($doc->issue_date), null);
        }

        return $locks->document($doc, $expectedVersion)->load('lines');
    }

    /**
     * What would stop this document from posting, without locks or side effects (submit fails early on it).
     *
     * @return list<Violation>
     */
    public function violations(Actor $actor, Postable&Model $doc): array
    {
        return match (true) {
            $doc instanceof Journal => $this->container->make(PreviewJournalPosting::class)->of($actor, $doc->id)->violations,
            $doc instanceof Invoice => $this->container->make(PreviewInvoicePosting::class)->of($actor, $doc->id)->violations,
            default => throw new \LogicException("No preview for {$doc->documentType()}."),
        };
    }

    /** Posts inside the caller's UnitOfWork; the poster re-locks (no-ops) and revalidates. */
    public function post(Actor $actor, Postable&Model $doc): Postable&Model
    {
        return match (true) {
            $doc instanceof Journal => $this->container->make(PostJournal::class)->handle($actor, new PostJournalInput($doc->documentId())),
            $doc instanceof Invoice => $this->container->make(PostInvoice::class)->handle($actor, $doc->documentId()),
            default => throw new \LogicException("No poster for {$doc->documentType()}."),
        };
    }

    /**
     * Who may void (13 §10), on top of "the creator or an approver" that VoidDocument already requires. A person
     * needs `<type>s.void`, or may void as an approver; the Sales Assistant's `invoices.void_own` covers the
     * person's own drafts only (not documents already waiting for approval).
     */
    public function authorizeVoid(Actor $actor, Postable&Model $doc): void
    {
        if (! $doc instanceof Invoice || $actor->isApiClient()) {
            return; // journals keep VoidDocument's rule; a token's ability was checked by the route policy
        }
        $module = $doc->kind->documentType().'s';
        $company = $doc->company_id;
        $own = $actor->id !== null && $doc->created_by === $actor->id;

        $ok = $this->permissions->allows($actor, "{$module}.void", $company)
            || $this->permissions->allows($actor, "{$module}.approve", $company)
            || ($own && $doc->status === DocumentStatus::Draft && $this->permissions->allows($actor, "{$module}.void_own", $company));
        if (! $ok) {
            throw DomainRuleViolation::single('forbidden', "You cannot void this {$doc->kind->label()}.");
        }
    }
}
