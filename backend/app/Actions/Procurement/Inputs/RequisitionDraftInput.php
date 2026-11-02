<?php

declare(strict_types=1);

namespace App\Actions\Procurement\Inputs;

use DateTimeImmutable;

final readonly class RequisitionDraftInput
{
    /** @param list<RequisitionLineInput> $lines */
    public function __construct(
        public string $companyId,
        public DateTimeImmutable $requisitionDate,
        public array $lines,
        public ?string $memo = null,
        public ?string $id = null,
    ) {}
}
