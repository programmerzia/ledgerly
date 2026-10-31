<?php

declare(strict_types=1);

namespace App\Actions\Organisation\Inputs;

final readonly class CreateCompanyInput
{
    public function __construct(
        public string $name,
        public string $country,
        public string $baseCurrency,
        public int $fiscalYearStartMonth,
        public ?string $legalName = null,
        public ?string $taxId = null,
        public string $timezone = 'UTC',
    ) {}
}
