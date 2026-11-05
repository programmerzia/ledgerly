<?php

declare(strict_types=1);

namespace App\Queries\FixedAssets;

use App\Domain\FixedAssets\TaxDepreciation;
use App\Models\FixedAssets\AssetTaxClass;
use App\Models\FixedAssets\FixedAsset;
use Illuminate\Support\Facades\DB;

/**
 * Tax depreciation per asset (plan 3c.15b): reads the register and the tax classes and nothing else. It never writes, never touches
 * the journals or balances, and is not cached with the ledger. The first year is the fiscal year the asset became available for use
 * in (the calendar year of its start); each following year is the next. A disposed asset stops after the year it was disposed of.
 */
final class TaxDepreciationSchedule
{
    public function __invoke(string $companyId, ?int $fromYear = null, ?int $toYear = null): TaxScheduleData
    {
        $classes = AssetTaxClass::query()->where('company_id', $companyId)->get()->keyBy('id');
        $fiscalYears = DB::table('fiscal_years')->where('company_id', $companyId)->orderBy('starts_on')->get(['name', 'starts_on', 'ends_on']);
        $labelOf = static function (int $year) use ($fiscalYears): string {
            foreach ($fiscalYears as $fy) {
                if ((int) substr((string) $fy->starts_on, 0, 4) === $year) {
                    return (string) $fy->name;
                }
            }

            return (string) $year;
        };
        $yearOf = static function (string $date) use ($fiscalYears): int {
            foreach ($fiscalYears as $fy) {
                if ($date >= substr((string) $fy->starts_on, 0, 10) && $date <= substr((string) $fy->ends_on, 0, 10)) {
                    return (int) substr((string) $fy->starts_on, 0, 4);
                }
            }

            return (int) substr($date, 0, 4);
        };

        $assets = [];
        $totals = [];
        foreach (FixedAsset::query()->where('company_id', $companyId)->whereNotNull('tax_class_id')->orderBy('number')->get() as $asset) {
            $class = $classes->get((string) $asset->tax_class_id);
            if ($class === null) {
                continue;
            }
            $first = $yearOf($asset->available_from->format('Y-m-d'));
            $stop = $asset->disposed_on === null ? null : $yearOf($asset->disposed_on->format('Y-m-d'));
            $years = [];
            foreach (TaxDepreciation::schedule($asset->acquisition_cost, $class->annual_rate_bp, $class->first_year_rate_bp) as $row) {
                $year = $first + $row['year_index'];
                if ($stop !== null && $year > $stop) {
                    break;
                }
                if (($fromYear !== null && $year < $fromYear) || ($toYear !== null && $year > $toYear)) {
                    continue;
                }
                $years[] = new TaxScheduleYear($year, $labelOf($year), $row['allowance'], $row['written_down']);
                $totals[$year] ??= ['allowance' => 0, 'written_down' => 0];
                $totals[$year]['allowance'] += $row['allowance'];
                $totals[$year]['written_down'] += $row['written_down'];
            }
            $assets[] = new TaxScheduleAsset($asset->id, $asset->number, $asset->name, $class->name, $asset->acquisition_cost, $class->annual_rate_bp, $class->first_year_rate_bp, $stop, $years);
        }
        ksort($totals);
        $byYear = [];
        foreach ($totals as $year => $t) {
            $byYear[] = new TaxScheduleYear($year, $labelOf($year), $t['allowance'], $t['written_down']);
        }

        return new TaxScheduleData($assets, $byYear);
    }
}
