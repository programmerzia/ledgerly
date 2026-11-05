<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Http\Support\Json;
use App\Queries\FixedAssets\TaxScheduleAsset;
use App\Queries\FixedAssets\TaxScheduleData;
use App\Queries\FixedAssets\TaxScheduleYear;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The tax depreciation schedule: per asset and in total, each year's allowance and the tax written-down value at its end. A report
 * only; it never posts.
 *
 * @mixin TaxScheduleData
 */
final class TaxScheduleResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        $cur = Json::baseCurrency($request);
        $year = static fn (TaxScheduleYear $y): array => [
            'year' => $y->year, 'label' => $y->label, 'allowance' => Json::money($y->allowance, $cur), 'written_down' => Json::money($y->writtenDown, $cur),
        ];

        return [
            'assets' => array_map(static fn (TaxScheduleAsset $a): array => [
                'asset_id' => $a->assetId, 'number' => $a->number, 'name' => $a->name, 'class_name' => $a->className, 'cost' => Json::money($a->cost, $cur),
                'annual_rate_bp' => $a->annualRateBp, 'first_year_rate_bp' => $a->firstYearRateBp, 'stopped_after_year' => $a->stoppedAfterYear,
                'years' => array_map($year, $a->years),
            ], $this->assets),
            'by_year' => array_map($year, $this->byYear),
        ];
    }
}
