<?php

declare(strict_types=1);

namespace App\Actions\FixedAssets\Inputs;

final readonly class DepreciationRunInput
{
    /** @param array<string, int> $units asset id → units used in the run (units-of-production assets only) */
    public function __construct(public string $companyId, public string $periodId, public array $units = [], public ?string $memo = null) {}
}
