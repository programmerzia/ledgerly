<?php

declare(strict_types=1);

namespace App\Events\Banking;

use App\Contracts\OutboxEvent;

/** A finished bank reconciliation was reopened. */
final readonly class BankReconciliationReopened implements OutboxEvent
{
    /** @param  array<string, mixed>  $data */
    public function __construct(public string $id, public string $companyId, public int $version = 0, public array $data = []) {}

    public function type(): string
    {
        return 'bank_reconciliation.reopened';
    }

    public function payload(): array
    {
        return ['id' => $this->id, 'company_id' => $this->companyId, 'version' => $this->version, ...$this->data];
    }
}
