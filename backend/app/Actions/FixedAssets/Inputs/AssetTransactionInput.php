<?php

declare(strict_types=1);

namespace App\Actions\FixedAssets\Inputs;

final readonly class AssetTransactionInput
{
    /**
     * @param  array<string, int>  $lines  asset id → impairment or reversal amount, revalued amount, or 0 for a disposal
     * @param  array<string, mixed>  $params  disposal: proceeds, proceeds_account_id, transfer_reserve
     */
    public function __construct(
        public string $companyId,
        public string $kind,
        public string $txDate,
        public array $lines,
        public ?string $categoryId = null,
        public ?string $reason = null,
        public array $params = [],
    ) {}
}
