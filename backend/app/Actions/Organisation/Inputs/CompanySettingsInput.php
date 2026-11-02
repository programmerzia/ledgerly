<?php

declare(strict_types=1);

namespace App\Actions\Organisation\Inputs;

/** A partial update of the company profile and settings: only the keys given change. */
final readonly class CompanySettingsInput
{
    /**
     * @param  array<string, mixed>  $profile  name, legal_name, tax_id, timezone, locale
     * @param  array<string, string|null>  $postingAccounts  key → account id (null clears the key)
     */
    public function __construct(
        public string $companyId,
        public array $profile = [],
        public ?string $taxRounding = null,
        public array $postingAccounts = [],
        public ?int $version = null,
        public bool $setsJournalThreshold = false,
        public ?int $journalThreshold = null,
    ) {}
}
