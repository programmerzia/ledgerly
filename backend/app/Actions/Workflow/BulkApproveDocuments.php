<?php

declare(strict_types=1);

namespace App\Actions\Workflow;

use App\Actions\Workflow\Inputs\BulkApprovalResult;
use App\Actions\Workflow\Inputs\DocumentRef;
use App\Domain\Shared\DomainRuleViolation;
use App\Services\Workflow\Documents;
use App\Support\Actor;
use App\Support\ActorType;
use Throwable;

/**
 * Approve many documents on one signing grant (doc 14 E5; the mock's `bulkApprove`). The grant, from one PIN entry, is
 * checked once up front. After that each document is approved by `ApproveDocument` in its own UnitOfWork, so every
 * rule (maker ≠ checker, distinct approvers, the step's role, period, validation) applies per document, and one that
 * fails is reported and rolled back alone while the rest go on.
 *
 * Documents are taken in (type, id) order whatever order they were sent in, so two overlapping batches take the same
 * locks in the same sequence; a batch holds the locks of one document at a time. A batch is limited to MAX documents,
 * and a document listed twice counts once. Results come back in the order the caller sent them.
 */
final class BulkApproveDocuments
{
    public const int MAX = 50;

    public function __construct(private readonly ApproveDocument $approve, private readonly Documents $documents) {}

    /**
     * @param  list<DocumentRef>  $documents
     * @return list<BulkApprovalResult>
     */
    public function handle(Actor $actor, array $documents, ?string $comment = null): array
    {
        if ($actor->type !== ActorType::User || $actor->id === null) {
            throw DomainRuleViolation::single('forbidden', 'Only a person can approve.');
        }
        if (! $actor->hasSigningGrant) {
            throw DomainRuleViolation::single('signature_required', 'Approving needs your signing PIN.');
        }
        $unique = [];
        foreach ($documents as $ref) {
            $unique[$ref->type.':'.$ref->id] ??= $ref;
        }
        if ($unique === []) {
            throw DomainRuleViolation::single('bulk_empty', 'Choose at least one document to approve.');
        }
        if (count($unique) > self::MAX) {
            throw DomainRuleViolation::single('bulk_too_large', 'Approve at most '.self::MAX.' documents at a time.');
        }

        // One batch is one request: the idempotency key belongs to it, not to each document's transaction.
        $inner = new Actor($actor->type, $actor->id, $actor->tenantId, $actor->companyId, $actor->hasSigningGrant, $actor->ip, $actor->userAgent, $actor->requestId);

        $ordered = $unique;
        uksort($ordered, strcmp(...));
        $results = [];
        foreach ($ordered as $key => $ref) {
            $results[$key] = $this->one($inner, $ref, $comment);
        }

        return array_map(fn (string $key) => $results[$key], array_keys($unique));
    }

    private function one(Actor $actor, DocumentRef $ref, ?string $comment): BulkApprovalResult
    {
        if (! in_array($ref->type, Documents::TYPES, true)) {
            return BulkApprovalResult::failed($ref, 'document_type_unknown', "Unknown document type {$ref->type}.");
        }
        try {
            // The route is one company's: another company's document is as good as missing.
            if ($this->documents->find($ref)->documentCompanyId() !== $actor->companyId) {
                throw DomainRuleViolation::single('not_found', 'The document does not exist.');
            }
            $doc = $this->approve->handle($actor, $ref, $comment);

            // A revision has no number of its own, and strict models throw on a missing attribute.
            $number = $doc->getAttributes()['number'] ?? null;

            return BulkApprovalResult::approved($ref, $doc->documentStatus()->value, is_string($number) ? $number : null);
        } catch (DomainRuleViolation $e) {
            return BulkApprovalResult::failed($ref, $e->errorCode, $e->getMessage());
        } catch (Throwable $e) {
            report($e);

            return BulkApprovalResult::failed($ref, 'error', 'This document could not be approved. Try it on its own.');
        }
    }
}
