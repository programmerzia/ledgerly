<?php

declare(strict_types=1);

namespace App\Events\Trade;

use App\Contracts\OutboxEvent;

/** An invoice, credit note, bill or debit note was posted: `invoice.posted` or `bill.posted`. */
final readonly class TradeDocumentPosted implements OutboxEvent
{
    public function __construct(
        public string $documentType,
        public string $documentId,
        public string $companyId,
        public string $kind,
        public string $number,
        public string $journalId,
        public int $version,
    ) {}

    public function type(): string
    {
        return $this->documentType.'.posted';
    }

    public function payload(): array
    {
        return [
            'document_id' => $this->documentId, 'company_id' => $this->companyId, 'kind' => $this->kind,
            'number' => $this->number, 'journal_id' => $this->journalId, 'version' => $this->version,
        ];
    }
}
