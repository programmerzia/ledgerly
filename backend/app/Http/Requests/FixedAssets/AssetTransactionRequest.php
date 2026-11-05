<?php

declare(strict_types=1);

namespace App\Http\Requests\FixedAssets;

use App\Actions\FixedAssets\Inputs\AssetTransactionInput;
use App\Http\Requests\CompanyRequest;
use Illuminate\Validation\Rule;

/**
 * A disposal (one asset, proceeds), an impairment or its reversal (one asset, an amount, a reason) or a revaluation (a category and
 * a revalued amount for every asset in it). Also the body of the preview.
 */
final class AssetTransactionRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'kind' => ['required', 'string', Rule::in(['disposal', 'impairment', 'impairment_reversal', 'revaluation'])],
            'tx_date' => ['required', 'date_format:Y-m-d'],
            'reason' => ['nullable', 'string', 'max:2000'],
            'asset_id' => ['required_unless:kind,revaluation', 'nullable', 'uuid', $this->inCompany('fixed_assets')],
            /** Minor units: the impairment or the reversal. */
            'amount' => ['required_if:kind,impairment,impairment_reversal', 'nullable', 'integer', 'min:1'],
            /** Disposal proceeds in minor units; none (0) when scrapped. */
            'proceeds' => ['nullable', 'integer', 'min:0'],
            'proceeds_account_id' => ['nullable', 'uuid', $this->inCompany('accounts')->whereNull('deleted_at')],
            /** Move the asset's remaining revaluation reserve straight to retained earnings. */
            'transfer_reserve' => ['nullable', 'boolean'],
            'category_id' => ['required_if:kind,revaluation', 'nullable', 'uuid', $this->inCompany('asset_categories')],
            /** Revaluation: the new carrying amount of every asset in the category. */
            'values' => ['required_if:kind,revaluation', 'nullable', 'array', 'max:500'],
            'values.*.asset_id' => ['required', 'uuid', $this->inCompany('fixed_assets')],
            'values.*.value' => ['required', 'integer', 'min:1'],
        ];
    }

    public function toInput(): AssetTransactionInput
    {
        $v = $this->validated();
        $kind = (string) $v['kind'];
        $lines = [];
        if ($kind === 'revaluation') {
            foreach ((array) $v['values'] as $row) {
                $lines[(string) $row['asset_id']] = (int) $row['value'];
            }
        } else {
            $lines[(string) $v['asset_id']] = $kind === 'disposal' ? 0 : (int) $v['amount'];
        }

        return new AssetTransactionInput(
            companyId: $this->company()->id,
            kind: $kind,
            txDate: (string) $v['tx_date'],
            lines: $lines,
            categoryId: isset($v['category_id']) ? (string) $v['category_id'] : null,
            reason: isset($v['reason']) ? trim((string) $v['reason']) : null,
            params: $kind === 'disposal' ? [
                'proceeds' => (int) ($v['proceeds'] ?? 0),
                'proceeds_account_id' => isset($v['proceeds_account_id']) ? (string) $v['proceeds_account_id'] : null,
                'transfer_reserve' => (bool) ($v['transfer_reserve'] ?? false),
            ] : [],
        );
    }
}
