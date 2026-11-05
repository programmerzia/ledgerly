<?php

declare(strict_types=1);

namespace App\Services\FixedAssets;

use App\Domain\FixedAssets\DepreciationCharge;
use App\Models\FixedAssets\AssetCategory;
use App\Models\FixedAssets\FixedAsset;

/**
 * What a depreciation run for one period would charge: a line per asset with months due, and the units-of-production assets
 * still waiting for their units (`pendingUnits`), which a run cannot include until someone enters them.
 */
final readonly class DepreciationPlan
{
    /**
     * @param  list<array{asset: FixedAsset, category: AssetCategory, charge: DepreciationCharge}>  $lines
     * @param  list<FixedAsset>  $pendingUnits
     */
    public function __construct(public array $lines, public array $pendingUnits, public int $total) {}

    public function isEmpty(): bool
    {
        return $this->lines === [];
    }

    /** True when something is due, whether or not the run can be made yet (units missing). */
    public function hasWork(): bool
    {
        return $this->lines !== [] || $this->pendingUnits !== [];
    }
}
