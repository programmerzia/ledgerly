<?php

declare(strict_types=1);

namespace App\Http\Requests\FixedAssets;

use App\Actions\FixedAssets\Inputs\FixedAssetInput;
use App\Actions\FixedAssets\Inputs\FixedAssetUpdateInput;
use App\Domain\FixedAssets\DepreciationMethod;
use App\Http\Requests\CompanyRequest;
use Illuminate\Validation\Rule;

/**
 * Create (POST) a register entry, from a posted line (`source_type` + `source_id`) or as an opening asset (cost, acquisition
 * date, accumulated depreciation and the date it is stated at), and replace its editable part (PUT, with `version`).
 */
final class FixedAssetRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        $update = $this->isMethod('PUT');

        return [
            'name' => ['required', 'string', 'max:200'],
            'description' => ['nullable', 'string', 'max:2000'],
            'category_id' => [$update ? 'prohibited' : 'required', 'uuid', $this->inCompany('asset_categories')],
            'source_type' => [$update ? 'prohibited' : 'nullable', 'string', Rule::in(['bill_line', 'journal_line']), 'required_with:source_id'],
            'source_id' => [$update ? 'prohibited' : 'nullable', 'uuid', 'required_with:source_type'],
            'acquired_on' => [$update ? 'prohibited' : 'nullable', 'date_format:Y-m-d'],
            'available_from' => [$update ? 'prohibited' : 'nullable', 'date_format:Y-m-d'],
            /** Minor units. Defaults to the posted line's amount when capitalising. */
            'cost' => [$update ? 'prohibited' : 'nullable', 'integer', 'min:1'],
            'residual' => ['nullable', 'integer', 'min:0'],
            'method' => ['nullable', 'string', Rule::in(DepreciationMethod::values())],
            'useful_life_months' => ['nullable', 'integer', 'min:1', 'max:1200'],
            /** Annual rate in basis points: 2000 = 20% a year. */
            'declining_rate_bp' => ['nullable', 'integer', 'min:1', 'max:10000'],
            'units_total' => ['nullable', 'integer', 'min:1'],
            /** Dimension id → value id. */
            'dimensions' => ['nullable', 'array', 'max:8'],
            'dimensions.*' => ['string', 'uuid'],
            'opening_accumulated' => [$update ? 'prohibited' : 'nullable', 'integer', 'min:0'],
            'opening_as_of' => [$update ? 'prohibited' : 'nullable', 'date_format:Y-m-d'],
            'version' => [$update ? 'required' : 'prohibited', 'integer', 'min:0'],
        ];
    }

    public function toInput(): FixedAssetInput
    {
        $v = $this->validated();

        return new FixedAssetInput(
            companyId: $this->company()->id,
            name: trim((string) $v['name']),
            categoryId: (string) $v['category_id'],
            sourceType: isset($v['source_type']) ? (string) $v['source_type'] : null,
            sourceId: isset($v['source_id']) ? (string) $v['source_id'] : null,
            acquiredOn: isset($v['acquired_on']) ? (string) $v['acquired_on'] : null,
            availableFrom: isset($v['available_from']) ? (string) $v['available_from'] : null,
            cost: isset($v['cost']) ? (int) $v['cost'] : null,
            residual: (int) ($v['residual'] ?? 0),
            method: isset($v['method']) ? (string) $v['method'] : null,
            lifeMonths: isset($v['useful_life_months']) ? (int) $v['useful_life_months'] : null,
            decliningRateBp: isset($v['declining_rate_bp']) ? (int) $v['declining_rate_bp'] : null,
            unitsTotal: isset($v['units_total']) ? (int) $v['units_total'] : null,
            description: $v['description'] ?? null,
            dimensions: array_map('strval', (array) ($v['dimensions'] ?? [])),
            openingAccumulated: (int) ($v['opening_accumulated'] ?? 0),
            openingAsOf: isset($v['opening_as_of']) ? (string) $v['opening_as_of'] : null,
        );
    }

    public function toUpdate(): FixedAssetUpdateInput
    {
        $v = $this->validated();

        return new FixedAssetUpdateInput(
            name: trim((string) $v['name']),
            description: $v['description'] ?? null,
            residual: (int) ($v['residual'] ?? 0),
            method: (string) ($v['method'] ?? 'straight_line'),
            lifeMonths: isset($v['useful_life_months']) ? (int) $v['useful_life_months'] : null,
            decliningRateBp: isset($v['declining_rate_bp']) ? (int) $v['declining_rate_bp'] : null,
            unitsTotal: isset($v['units_total']) ? (int) $v['units_total'] : null,
            dimensions: array_map('strval', (array) ($v['dimensions'] ?? [])),
            version: (int) $v['version'],
        );
    }
}
