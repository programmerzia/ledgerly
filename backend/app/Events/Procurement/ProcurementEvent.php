<?php

declare(strict_types=1);

namespace App\Events\Procurement;

use App\Contracts\OutboxEvent;

/** `purchase_requisition.approved`, `purchase_order.approved|revised|cancelled|closed`, `goods_receipt.recorded|reversed`, `bill.match_overridden`. */
final readonly class ProcurementEvent implements OutboxEvent
{
    /** @param array<string, mixed> $data */
    public function __construct(
        private string $eventType,
        public string $documentId,
        public string $companyId,
        public int $version,
        public array $data = [],
    ) {}

    public function type(): string
    {
        return $this->eventType;
    }

    public function payload(): array
    {
        return ['document_id' => $this->documentId, 'company_id' => $this->companyId, 'version' => $this->version, ...$this->data];
    }
}
