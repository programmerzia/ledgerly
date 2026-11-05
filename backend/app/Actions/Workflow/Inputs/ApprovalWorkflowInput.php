<?php

declare(strict_types=1);

namespace App\Actions\Workflow\Inputs;

final readonly class ApprovalWorkflowInput
{
    /** @param list<array{role: string, count: int}> $steps in order; each step needs `count` distinct approvers holding `role` */
    public function __construct(
        public string $companyId,
        public string $documentType,
        public string $name,
        /** any | user | api: which submitters the workflow applies to */
        public string $source,
        public int $minAmount,
        public ?int $maxAmount,
        public array $steps,
        /** Remind the current step's approvers when the document has waited this many hours, then again each further interval; null: never. */
        public ?int $remindAfterHours = null,
    ) {}
}
