<?php

declare(strict_types=1);

namespace App\Events\Procurement;

use App\Contracts\OutboxEvent;
use InvalidArgumentException;

/** `purchase_requisition.approved`, `purchase_order.approved|revised|cancelled|closed`, `goods_receipt.recorded|reversed`, `bill.match_overridden`. */
final readonly class ProcurementEvent implements OutboxEvent
{
    public const array TYPES = [
        'purchase_requisition.approved', 'purchase_requisition.rejected',
        'purchase_order.approved', 'purchase_order.revised', 'purchase_order.cancelled', 'purchase_order.closed',
        'goods_receipt.recorded', 'goods_receipt.reversed', 'bill.match_overridden',
    ];

    /** @param array<string, mixed> $data */
    public function __construct(
        private string $eventType,
        public string $documentId,
        public string $companyId,
        public int $version,
        public array $data = [],
    ) {
        if (! in_array($eventType, self::TYPES, true)) {
            throw new InvalidArgumentException("Unknown procurement event {$eventType}.");
        }
    }

    public function type(): string
    {
        return $this->eventType;
    }

    public function payload(): array
    {
        return ['document_id' => $this->documentId, 'company_id' => $this->companyId, 'version' => $this->version, ...$this->data];
    }
}
