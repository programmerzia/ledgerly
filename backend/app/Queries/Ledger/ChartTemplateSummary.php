<?php

declare(strict_types=1);

namespace App\Queries\Ledger;

/** One entry of the chart template picker (02 §3): what the template is and how big it is. */
final readonly class ChartTemplateSummary
{
    public function __construct(
        public string $code,
        public string $name,
        public ?string $country,
        public string $standard,
        public int $accountCount,
    ) {}

    /** @return array{code: string, name: string, country: string|null, standard: string, account_count: int} */
    public function toArray(): array
    {
        return [
            'code' => $this->code,
            'name' => $this->name,
            'country' => $this->country,
            'standard' => $this->standard,
            'account_count' => $this->accountCount,
        ];
    }
}
