<?php

declare(strict_types=1);

namespace App\Events\Fiscal;

use App\Contracts\OutboxEvent;

final readonly class FiscalYearLocked implements OutboxEvent
{
    /** @param array<string, mixed> $extra */
    public function __construct(public string $companyId, public string $subjectId, public array $extra = []) {}

    public function type(): string
    {
        return 'fiscal_year.locked';
    }

    public function payload(): array
    {
        return ['company_id' => $this->companyId, 'id' => $this->subjectId, ...$this->extra];
    }
}
