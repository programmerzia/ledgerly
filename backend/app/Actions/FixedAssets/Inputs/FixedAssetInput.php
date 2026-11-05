<?php

declare(strict_types=1);

namespace App\Actions\FixedAssets\Inputs;

/**
 * A new register entry. `sourceType`/`sourceId` (`bill_line` or `journal_line`) capitalise a posted line; without a source
 * the asset is an opening asset (cost and accumulated depreciation brought in at go-live), which posts nothing either way.
 */
final readonly class FixedAssetInput
{
    /** @param array<string, string> $dimensions dimension id → value id */
    public function __construct(
        public string $companyId,
        public string $name,
        public string $categoryId,
        public ?string $sourceType = null,
        public ?string $sourceId = null,
        public ?string $acquiredOn = null,
        public ?string $availableFrom = null,
        public ?int $cost = null,
        public int $residual = 0,
        public ?string $method = null,
        public ?int $lifeMonths = null,
        public ?int $decliningRateBp = null,
        public ?int $unitsTotal = null,
        public ?string $description = null,
        public array $dimensions = [],
        public int $openingAccumulated = 0,
        public ?string $openingAsOf = null,
    ) {}
}
