<?php

declare(strict_types=1);

namespace App\Events\Trade;

use App\Contracts\OutboxEvent;

final readonly class TradeDocumentReversed implements OutboxEvent
{
    public function __construct(
        public string $documentType,
        public string $documentId,
        public string $companyId,
        public string $reversalJournalId,
        public int $version,
    ) {}

    public function type(): string
    {
        return $this->documentType.'.reversed';
    }

    public function payload(): array
    {
        return [
            'document_id' => $this->documentId, 'company_id' => $this->companyId,
            'reversal_journal_id' => $this->reversalJournalId, 'version' => $this->version,
        ];
    }
}
