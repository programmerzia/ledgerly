<?php

declare(strict_types=1);

namespace App\Http\Requests\FixedAssets;

use App\Actions\FixedAssets\Inputs\DepreciationRunInput;
use App\Http\Requests\CompanyRequest;

/** A depreciation run for a period, with the units used this period for units-of-production assets. Also the preview's query. */
final class DepreciationRunRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'period_id' => ['required', 'uuid', $this->inCompany('fiscal_periods')],
            /** Asset id → units used in the period. */
            'units' => ['nullable', 'array', 'max:500'],
            'units.*' => ['integer', 'min:0'],
            'memo' => ['nullable', 'string', 'max:2000'],
        ];
    }

    public function periodId(): string
    {
        return (string) $this->validated()['period_id'];
    }

    /** @return array<string, int> */
    public function units(): array
    {
        $out = [];
        foreach ((array) ($this->validated()['units'] ?? []) as $assetId => $units) {
            $out[(string) $assetId] = (int) $units;
        }

        return $out;
    }

    public function toInput(): DepreciationRunInput
    {
        $v = $this->validated();

        return new DepreciationRunInput($this->company()->id, $this->periodId(), $this->units(), isset($v['memo']) ? (string) $v['memo'] : null);
    }
}
