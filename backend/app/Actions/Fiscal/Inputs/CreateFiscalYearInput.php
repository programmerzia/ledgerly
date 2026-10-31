<?php

declare(strict_types=1);

namespace App\Actions\Fiscal\Inputs;

use DateTimeImmutable;

final readonly class CreateFiscalYearInput
{
    public function __construct(public string $companyId, public DateTimeImmutable $startsOn, public string $name) {}
}
