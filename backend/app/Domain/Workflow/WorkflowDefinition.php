<?php

declare(strict_types=1);

namespace App\Domain\Workflow;

/** A candidate workflow as the resolver sees it; `source` null means it applies to any source. */
final readonly class WorkflowDefinition
{
    /** @param list<ApprovalStep> $steps */
    public function __construct(
        public string $id,
        public string $documentType,
        public ?DocumentSource $source,
        public int $minAmount,
        public ?int $maxAmount,
        public array $steps,
    ) {}

    public function covers(string $documentType, DocumentSource $source, int $amount): bool
    {
        return $this->documentType === $documentType
            && ($this->source === null || $this->source === $source)
            && $amount >= $this->minAmount
            && ($this->maxAmount === null || $amount < $this->maxAmount);
    }
}
