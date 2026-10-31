<?php

declare(strict_types=1);

namespace App\Domain\Workflow;

/**
 * Picks the workflow for a document by (type, source, base amount) (13 §10). Pure: the caller
 * loads the company's active workflows. When several cover the amount, the most specific wins:
 * an exact source beats "any", then the narrowest amount band (highest minimum). Null means no
 * workflow applies and submit posts at once.
 */
final class WorkflowResolver
{
    /** @param list<WorkflowDefinition> $workflows */
    public static function resolve(array $workflows, string $documentType, DocumentSource $source, int $amount): ?WorkflowDefinition
    {
        $best = null;
        foreach ($workflows as $candidate) {
            if (! $candidate->covers($documentType, $source, $amount)) {
                continue;
            }
            if ($best === null || self::moreSpecific($candidate, $best)) {
                $best = $candidate;
            }
        }

        return $best;
    }

    private static function moreSpecific(WorkflowDefinition $a, WorkflowDefinition $b): bool
    {
        if (($a->source !== null) !== ($b->source !== null)) {
            return $a->source !== null;
        }
        if ($a->minAmount !== $b->minAmount) {
            return $a->minAmount > $b->minAmount;
        }

        return ($a->maxAmount ?? PHP_INT_MAX) < ($b->maxAmount ?? PHP_INT_MAX);
    }
}
