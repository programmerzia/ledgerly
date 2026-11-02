<?php

declare(strict_types=1);

namespace App\Events\Banking;

use App\Contracts\OutboxEvent;

/** Statement lines were matched to book lines. */
final readonly class BankMatchCreated implements OutboxEvent
{
    /** @param  array<string, mixed>  $data */
    public function __construct(public string $id, public string $companyId, public int $version = 0, public array $data = []) {}

    public function type(): string
    {
        return 'bank_match.created';
    }

    public function payload(): array
    {
        return ['id' => $this->id, 'company_id' => $this->companyId, 'version' => $this->version, ...$this->data];
    }
}
