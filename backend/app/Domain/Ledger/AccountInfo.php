<?php

declare(strict_types=1);

namespace App\Domain\Ledger;

final readonly class AccountInfo
{
    /** @param array<int, DimensionRule> $dimensionRules position 1..8 → rule (missing = optional) */
    public function __construct(
        public string $id,
        public string $code,
        public bool $isPostable,
        public bool $isActive,
        public ControlType $controlType,
        public CurrencyPolicy $currencyPolicy,
        public ?string $fixedCurrency = null,
        public bool $allowManualJournals = false,
        public array $dimensionRules = [],
    ) {}
}
