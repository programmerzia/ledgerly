<?php

declare(strict_types=1);

namespace App\Http\Requests\FixedAssets;

use App\Actions\FixedAssets\Inputs\AssetCategoryInput;
use App\Domain\FixedAssets\DepreciationMethod;
use App\Http\Requests\CompanyRequest;
use Illuminate\Validation\Rule;

/** Create (POST) and replace (PUT, with the `version` it was based on) an asset category. */
final class AssetCategoryRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:120'],
            'asset_account_id' => ['required', 'uuid', $this->inCompany('accounts')->whereNull('deleted_at')],
            'accumulated_account_id' => ['required', 'uuid', $this->inCompany('accounts')->whereNull('deleted_at')],
            'expense_account_id' => ['required', 'uuid', $this->inCompany('accounts')->whereNull('deleted_at')],
            'measurement_model' => ['nullable', 'string', Rule::in(['cost', 'revaluation'])],
            'default_method' => ['nullable', 'string', Rule::in(DepreciationMethod::values())],
            'default_life_months' => ['nullable', 'integer', 'min:1', 'max:1200'],
            /** Annual rate in basis points: 2000 = 20% a year. */
            'default_declining_rate_bp' => ['nullable', 'integer', 'min:1', 'max:10000'],
            'is_depreciable' => ['nullable', 'boolean'],
            'is_active' => ['nullable', 'boolean'],
            'version' => [$this->isMethod('PUT') ? 'required' : 'prohibited', 'integer', 'min:0'],
        ];
    }

    public function toInput(): AssetCategoryInput
    {
        $v = $this->validated();

        return new AssetCategoryInput(
            companyId: $this->company()->id,
            name: trim((string) $v['name']),
            assetAccountId: (string) $v['asset_account_id'],
            accumulatedAccountId: (string) $v['accumulated_account_id'],
            expenseAccountId: (string) $v['expense_account_id'],
            measurementModel: (string) ($v['measurement_model'] ?? 'cost'),
            defaultMethod: (string) ($v['default_method'] ?? 'straight_line'),
            defaultLifeMonths: isset($v['default_life_months']) ? (int) $v['default_life_months'] : null,
            defaultDecliningRateBp: isset($v['default_declining_rate_bp']) ? (int) $v['default_declining_rate_bp'] : null,
            isDepreciable: (bool) ($v['is_depreciable'] ?? true),
            isActive: (bool) ($v['is_active'] ?? true),
            version: isset($v['version']) ? (int) $v['version'] : null,
        );
    }
}
