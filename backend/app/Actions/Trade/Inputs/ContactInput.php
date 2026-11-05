<?php

declare(strict_types=1);

namespace App\Actions\Trade\Inputs;

final readonly class ContactInput
{
    /**
     * @param  string  $kind  customer | supplier | both
     * @param  array<string, mixed>|null  $billingAddress
     * @param  array<string, mixed>|null  $shippingAddress
     * @param  int|null  $creditLimit  minor units of $defaultCurrency
     * @param  array<string, string>  $defaultDims  dimension id → value id
     */
    public function __construct(
        public string $companyId,
        public string $kind,
        public string $code,
        public string $name,
        public string $defaultCurrency,
        public ?string $legalName = null,
        public ?string $taxId = null,
        public ?string $email = null,
        public ?string $phone = null,
        public ?array $billingAddress = null,
        public ?array $shippingAddress = null,
        public int $paymentTermsDays = 0,
        public ?int $creditLimit = null,
        public ?string $arAccountId = null,
        public ?string $apAccountId = null,
        public ?string $whtCodeId = null,
        public ?string $defaultAccountId = null,
        public ?string $defaultTaxCodeId = null,
        public ?string $defaultBranch = null,
        public array $defaultDims = [],
        public ?string $notes = null,
        /** Stop overdue-invoice reminders for this contact (plan 3c.7); null leaves the stored choice as it is. */
        public ?bool $dunningOptOut = null,
    ) {}
}
