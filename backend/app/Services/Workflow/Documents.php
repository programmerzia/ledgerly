<?php

declare(strict_types=1);

namespace App\Services\Workflow;

use App\Actions\Ledger\Inputs\PostJournalInput;
use App\Actions\Ledger\PostJournal;
use App\Actions\Workflow\Inputs\DocumentRef;
use App\Contracts\Postable;
use App\Domain\Shared\DomainRuleViolation;
use App\Models\Ledger\Journal;
use App\Services\Ledger\PostingEngine;
use App\Support\Actor;
use App\Support\UnitOfWork\LockSet;
use Illuminate\Contracts\Container\Container;
use Illuminate\Database\Eloquent\Model;

/**
 * The per-type knowledge the workflow Actions need (13 §10): how to find a document, lock it in
 * the global order (its period first, then the row) and post it. Each Postable type registers here.
 */
final class Documents
{
    public const array TYPES = ['journal'];

    public function __construct(private readonly Container $container, private readonly PostingEngine $engine) {}

    /** Unlocked read. */
    public function find(DocumentRef $ref): Postable&Model
    {
        $doc = match ($ref->type) {
            'journal' => Journal::query()->with('lines')->find($ref->id),
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

        return $locks->document($doc, $expectedVersion)->load('lines');
    }

    /** Posts inside the caller's UnitOfWork; PostJournal re-locks (no-ops) and revalidates. */
    public function post(Actor $actor, Postable&Model $doc): Postable&Model
    {
        return match ($doc->documentType()) {
            'journal' => $this->container->make(PostJournal::class)->handle($actor, new PostJournalInput($doc->documentId())),
            default => throw new \LogicException("No poster for {$doc->documentType()}."),
        };
    }
}
