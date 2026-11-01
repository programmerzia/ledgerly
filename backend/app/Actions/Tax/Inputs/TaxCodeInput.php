<?php

declare(strict_types=1);

namespace App\Actions\Tax\Inputs;

final readonly class TaxCodeInput
{
    /** @param  string  $kind  vat | gst | sales | wht | compound | exempt | zero | reverse_charge */
    public function __construct(
        public string $companyId,
        public string $code,
        public string $name,
        public string $kind,
        public ?string $collectAccountId = null,
        public ?string $payAccountId = null,
        public bool $isRecoverable = false,
    ) {}
}
