<?php

declare(strict_types=1);

namespace App\Events\Trade;

use App\Contracts\OutboxEvent;

/** A receipt, payment or refund was posted. */
final readonly class SettlementPosted implements OutboxEvent
{
    /** @param  array<string, mixed>  $data */
    public function __construct(public string $documentId, public string $companyId, public int $version, public array $data = []) {}

    public function type(): string
    {
        return 'settlement.posted';
    }

    public function payload(): array
    {
        return ['document_id' => $this->documentId, 'company_id' => $this->companyId, 'version' => $this->version, ...$this->data];
    }
}
