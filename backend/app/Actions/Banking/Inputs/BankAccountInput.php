<?php

declare(strict_types=1);

namespace App\Actions\Banking\Inputs;

final readonly class BankAccountInput
{
    /** @param array<string, mixed>|null $importMapping */
    public function __construct(
        public string $companyId,
        public string $name,
        public string $accountId,
        public string $currency,
        public string $kind = 'bank',
        public ?string $bankName = null,
        public ?string $accountNumberMasked = null,
        public ?string $iban = null,
        public ?string $swift = null,
        public ?array $importMapping = null,
        public bool $isActive = true,
    ) {}
}
