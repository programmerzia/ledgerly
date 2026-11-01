<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Http\Support\Json;
use App\Models\Ledger\Account;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin Account */
final class AccountResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'code' => $this->code,
            'name' => $this->name,
            'account_type' => $this->account_type,
            'account_subtype' => $this->account_subtype,
            'normal_balance' => $this->normal_balance,
            'parent_id' => $this->parent_id,
            'currency_policy' => $this->currency_policy->value,
            'fixed_currency' => $this->fixed_currency,
            'control_type' => $this->control_type->value,
            'allow_manual_journals' => $this->allow_manual_journals,
            'is_postable' => $this->is_postable,
            'is_active' => $this->is_active,
            'description' => $this->description,
            'version' => $this->lock_version,
            // Dimension rules come with the single-account endpoints, not with the list.
            /** @var array<string, string> dimension id → required|optional|forbidden */
            'dimension_rules' => $this->whenLoaded('dimensionRules', fn () => $this->dimensionRules
                ->mapWithKeys(fn ($rule) => [$rule->dimension_id => $rule->rule->value])->all()),
            'can' => Json::can($request, $this->resource, ['update' => 'update', 'deactivate' => 'deactivate']),
        ];
    }
}
