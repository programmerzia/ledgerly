<?php

declare(strict_types=1);

namespace App\Events\Imports;

use App\Contracts\OutboxEvent;

/** An atomic import (opening balances) was refused as a whole; nothing was applied. */
final readonly class ImportFailed implements OutboxEvent
{
    /** @param  array<string, mixed>  $data */
    public function __construct(public string $id, public string $companyId, public int $version = 0, public array $data = []) {}

    public function type(): string
    {
        return 'import.failed';
    }

    public function payload(): array
    {
        return ['id' => $this->id, 'company_id' => $this->companyId, 'version' => $this->version, ...$this->data];
    }
}
