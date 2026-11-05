<?php

declare(strict_types=1);

namespace App\Events\Transactions;

use App\Contracts\OutboxEvent;
use InvalidArgumentException;

/** Events of the transaction documents of plan 3c.8 to 3c.12: transfers, write-offs, provisioning runs, credit-limit overrides. */
final readonly class TransactionEvent implements OutboxEvent
{
    public const array TYPES = [
        'fund_transfer.posted', 'fund_transfer.received', 'fund_transfer.reversed',
        'write_off.posted', 'write_off.reversed',
        'provision_run.posted', 'provision_run.reversed',
        'invoice.credit_limit_overridden',
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
            throw new InvalidArgumentException("Unknown transaction event {$eventType}.");
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
