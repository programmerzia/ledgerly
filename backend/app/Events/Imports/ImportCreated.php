<?php

declare(strict_types=1);

namespace App\Events\Imports;

use App\Contracts\OutboxEvent;

/** An import was uploaded and parsed. */
final readonly class ImportCreated implements OutboxEvent
{
    /** @param  array<string, mixed>  $data */
    public function __construct(public string $id, public string $companyId, public int $version = 0, public array $data = []) {}

    public function type(): string
    {
        return 'import.created';
    }

    public function payload(): array
    {
        return ['id' => $this->id, 'company_id' => $this->companyId, 'version' => $this->version, ...$this->data];
    }
}
