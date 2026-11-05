<?php

declare(strict_types=1);

namespace App\Domain\FixedAssets;

use App\Domain\Shared\DomainRuleViolation;

/** The estimates an asset needs for its method. Pure rules shared by creating an asset and changing an estimate. */
final class Estimates
{
    public static function assert(bool $depreciable, string $method, ?int $life, ?int $rateBp, ?int $unitsTotal): void
    {
        if (! in_array($method, DepreciationMethod::values(), true)) {
            throw DomainRuleViolation::single('asset_method_invalid', 'Unknown depreciation method.');
        }
        if (! $depreciable) {
            return;
        }
        if ($method === 'straight_line' && ($life === null || $life < 1 || $life > 1200)) {
            throw DomainRuleViolation::single('asset_life_required', 'Straight-line depreciation needs a useful life of 1 to 1200 months.');
        }
        if ($method === 'declining_balance' && ($rateBp === null || $rateBp < 1 || $rateBp > 10000)) {
            throw DomainRuleViolation::single('asset_rate_required', 'Declining-balance depreciation needs an annual rate (basis points, 1 to 10000).');
        }
        if ($method === 'units_of_production' && ($unitsTotal === null || $unitsTotal < 1)) {
            throw DomainRuleViolation::single('asset_units_required', 'Units-of-production depreciation needs the total expected units.');
        }
    }
}
