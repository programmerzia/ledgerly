<?php

declare(strict_types=1);

namespace App\Queries\FixedAssets;

/**
 * The preview of a depreciation run, ready for the API. `blockers` are stable codes: period_closed, depreciation_run_exists,
 * earlier_run_pending, units_required, nothing_to_depreciate.
 */
final readonly class DepreciationPreviewData
{
    /**
     * @param  list<DepreciationPreviewLine>  $lines
     * @param  list<DepreciationPreviewLine>  $pendingUnits  units-of-production assets waiting for their units (amount 0)
     * @param  list<string>  $blockers
     */
    public function __construct(
        public string $periodId,
        public string $periodName,
        public string $asOf,
        public int $total,
        public array $lines,
        public array $pendingUnits,
        public array $blockers,
    ) {}
}
