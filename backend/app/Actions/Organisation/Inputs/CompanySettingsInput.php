<?php

declare(strict_types=1);

namespace App\Actions\Organisation\Inputs;

/** A partial update of the company profile and settings: only the keys given change. */
final readonly class CompanySettingsInput
{
    /**
     * @param  array<string, mixed>  $profile  name, legal_name, tax_id, timezone, locale
     * @param  array<string, string|null>  $postingAccounts  key → account id (null clears the key)
     * @param  array<string, mixed>  $documentLook  accent_color, footer_text, payment_instructions, email_templates (plan 3c.4, 3c.5): only the keys given change
     */
    public function __construct(
        public string $companyId,
        public array $profile = [],
        public ?string $taxRounding = null,
        public array $postingAccounts = [],
        public ?int $version = null,
        public bool $setsJournalThreshold = false,
        public ?int $journalThreshold = null,
        public ?bool $requirePurchaseOrder = null,
        public ?string $poPriceTolerancePct = null,
        public ?string $poQuantityTolerancePct = null,
        public ?string $receiptOverTolerancePct = null,
        public array $documentLook = [],
        public ?string $creditLimitMode = null,
    ) {}
}
