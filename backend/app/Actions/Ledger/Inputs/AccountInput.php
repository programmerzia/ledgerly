<?php

declare(strict_types=1);

namespace App\Actions\Ledger\Inputs;

use App\Domain\Ledger\ControlType;
use App\Domain\Ledger\CurrencyPolicy;

final readonly class AccountInput
{
    public function __construct(
        public string $companyId,
        public string $code,
        public string $name,
        /** asset | liability | equity | income | expense */
        public string $accountType,
        /** debit | credit */
        public string $normalBalance,
        public ?string $parentId = null,
        public CurrencyPolicy $currencyPolicy = CurrencyPolicy::BaseOnly,
        public ?string $fixedCurrency = null,
        public ControlType $controlType = ControlType::None,
        public bool $allowManualJournals = false,
        public bool $isPostable = true,
        public ?string $accountSubtype = null,
        public ?string $description = null,
    ) {}
}
