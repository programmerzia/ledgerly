<?php

declare(strict_types=1);

namespace App\Actions\FixedAssets\Inputs;

/** The editable part of a register entry. The estimates (residual, life, method, rate, units) are changes of estimate (IAS 8): they apply from the next depreciation run. */
final readonly class FixedAssetUpdateInput
{
    /** @param array<string, string> $dimensions dimension id → value id */
    public function __construct(
        public string $name,
        public ?string $description,
        public int $residual,
        public string $method,
        public ?int $lifeMonths,
        public ?int $decliningRateBp,
        public ?int $unitsTotal,
        public array $dimensions,
        public ?string $taxClassId = null,
        public ?int $version = null,
    ) {}
}
