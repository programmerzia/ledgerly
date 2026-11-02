<?php

declare(strict_types=1);

namespace App\Events\Banking;

use App\Contracts\OutboxEvent;

/** A bank line was coded as spend, receive or transfer money. */
final readonly class BankTransactionCreated implements OutboxEvent
{
    /** @param  array<string, mixed>  $data */
    public function __construct(public string $id, public string $companyId, public int $version = 0, public array $data = []) {}

    public function type(): string
    {
        return 'bank_transaction.created';
    }

    public function payload(): array
    {
        return ['id' => $this->id, 'company_id' => $this->companyId, 'version' => $this->version, ...$this->data];
    }
}
