<?php

declare(strict_types=1);

namespace App\Events\Imports;

use App\Contracts\OutboxEvent;

/** An import finished applying (some rows may have failed; see rows_failed). */
final readonly class ImportApplied implements OutboxEvent
{
    /** @param  array<string, mixed>  $data */
    public function __construct(public string $id, public string $companyId, public int $version = 0, public array $data = []) {}

    public function type(): string
    {
        return 'import.applied';
    }

    public function payload(): array
    {
        return ['id' => $this->id, 'company_id' => $this->companyId, 'version' => $this->version, ...$this->data];
    }
}
