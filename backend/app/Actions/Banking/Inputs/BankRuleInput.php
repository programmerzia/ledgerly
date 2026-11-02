<?php

declare(strict_types=1);

namespace App\Actions\Banking\Inputs;

final readonly class BankRuleInput
{
    /**
     * @param  array{contains: string, direction: string, min_amount?: int|null, max_amount?: int|null}  $conditions
     * @param  array{account_id: string, tax_code_id?: string|null, contact_id?: string|null, dimensions?: array<string, string>, memo?: string|null}  $action
     */
    public function __construct(
        public string $companyId,
        public string $name,
        public array $conditions,
        public array $action,
        public ?string $bankAccountId = null,
        public bool $isActive = true,
        /** Null = after the last rule. */
        public ?int $priority = null,
    ) {}
}
