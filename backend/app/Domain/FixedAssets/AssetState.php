<?php

declare(strict_types=1);

namespace App\Domain\FixedAssets;

/**
 * An asset's figures at a point in time, everything a calculator needs and nothing else. Amounts are minor units, the
 * rate is basis points a year. `counterfactualCarrying` is the carrying amount the asset would have had without its
 * impairment (null while it has none): every depreciation run advances it, and it caps an impairment reversal (IAS 36.117).
 */
final readonly class AssetState
{
    public function __construct(
        public int $cost,
        public int $residual,
        public int $accumulatedDepreciation,
        public int $accumulatedImpairment,
        public DepreciationMethod $method,
        public ?int $lifeMonths,
        public ?int $decliningRateBp,
        public ?int $unitsTotal,
        public int $unitsUsed,
        public int $monthsCharged,
        public string $availableFrom,
        public ?string $depreciatedThrough,
        public bool $depreciable = true,
        public bool $disposed = false,
        public ?int $counterfactualCarrying = null,
        public int $revaluationReserve = 0,
        public int $revaluationDeficit = 0,
        public bool $revalued = false,
    ) {}

    public function carrying(): int
    {
        return $this->cost - $this->accumulatedDepreciation - $this->accumulatedImpairment;
    }
}
