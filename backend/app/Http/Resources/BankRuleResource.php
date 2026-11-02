<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Http\Support\Json;
use App\Models\Banking\BankRule;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin BankRule */
final class BankRuleResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'bank_account_id' => $this->bank_account_id,
            'name' => $this->name,
            /** Lower runs first; the first matching rule wins. */
            'priority' => $this->priority,
            'is_active' => $this->is_active,
            /** @var array{contains: string, direction: string, min_amount?: int|null, max_amount?: int|null} $conditions */
            'conditions' => $this->conditions,
            /** @var array{account_id: string, tax_code_id?: string|null, contact_id?: string|null, dimensions?: array<string, string>, memo?: string|null} $action */
            'action' => $this->action,
            'times_applied' => $this->times_applied,
            'version' => $this->lock_version,
            'can' => Json::can($request, $this->resource, ['update' => 'manageRules', 'delete' => 'manageRules']),
        ];
    }
}
