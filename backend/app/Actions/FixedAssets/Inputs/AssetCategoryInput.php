<?php

declare(strict_types=1);

namespace App\Actions\FixedAssets\Inputs;

final readonly class AssetCategoryInput
{
    public function __construct(
        public string $companyId,
        public string $name,
        public string $assetAccountId,
        public string $accumulatedAccountId,
        public string $expenseAccountId,
        public string $measurementModel = 'cost',
        public string $defaultMethod = 'straight_line',
        public ?int $defaultLifeMonths = null,
        public ?int $defaultDecliningRateBp = null,
        public bool $isDepreciable = true,
        public bool $isActive = true,
        public ?int $version = null,
    ) {}
}
