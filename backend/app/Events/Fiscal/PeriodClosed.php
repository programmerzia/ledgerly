<?php

declare(strict_types=1);

namespace App\Events\Fiscal;

use App\Contracts\OutboxEvent;

final readonly class PeriodClosed implements OutboxEvent
{
    /** @param array<string, mixed> $extra */
    public function __construct(public string $companyId, public string $subjectId, public array $extra = []) {}

    public function type(): string
    {
        return 'period.closed';
    }

    public function payload(): array
    {
        return ['company_id' => $this->companyId, 'id' => $this->subjectId, ...$this->extra];
    }
}
