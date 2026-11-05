<?php

declare(strict_types=1);

namespace App\Http\Requests\FixedAssets;

use App\Http\Requests\CompanyRequest;

/** Create (POST) and replace (PUT, with `version`) a tax depreciation class. Rates are basis points a year: 2000 = 20%. */
final class AssetTaxClassRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        $update = $this->isMethod('PUT');

        return [
            'code' => [$update ? 'prohibited' : 'required', 'string', 'max:32', 'regex:/^[A-Za-z0-9._-]+$/'],
            'name' => ['required', 'string', 'max:120'],
            'annual_rate_bp' => ['required', 'integer', 'min:1', 'max:10000'],
            /** Optional rate for the first year only. */
            'first_year_rate_bp' => ['nullable', 'integer', 'min:1', 'max:10000'],
            'is_active' => ['nullable', 'boolean'],
            'version' => [$update ? 'required' : 'prohibited', 'integer', 'min:0'],
        ];
    }
}
