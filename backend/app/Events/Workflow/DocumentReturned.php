<?php

declare(strict_types=1);

namespace App\Events\Workflow;

use App\Contracts\OutboxEvent;

final readonly class DocumentReturned implements OutboxEvent
{
    /** @param array<string, mixed> $extra */
    public function __construct(public string $documentType, public string $documentId, public string $companyId, public int $version, public array $extra = []) {}

    public function type(): string
    {
        return 'document.'.strtolower('Returned');
    }

    public function payload(): array
    {
        return ['document_type' => $this->documentType, 'document_id' => $this->documentId, 'company_id' => $this->companyId, 'version' => $this->version, ...$this->extra];
    }
}
