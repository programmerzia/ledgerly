<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Http\Support\Json;
use App\Models\FixedAssets\AssetTransaction;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A disposal, impairment, impairment reversal or revaluation. Money is in the base currency. `amount` is the size of the event
 * (cost disposed, amount impaired or reversed, total revaluation change).
 *
 * @mixin AssetTransaction
 */
final class AssetTransactionResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        $cur = Json::baseCurrency($request);

        return [
            'id' => $this->id,
            'number' => $this->number,
            'kind' => $this->kind,
            'status' => $this->status->value,
            'tx_date' => Json::date($this->tx_date),
            'category_id' => $this->category_id,
            'amount' => Json::money($this->amount, $cur),
            'reason' => $this->reason,
            'proceeds' => Json::money((int) ($this->params['proceeds'] ?? 0), $cur),
            'proceeds_account_id' => isset($this->params['proceeds_account_id']) ? (string) $this->params['proceeds_account_id'] : null,
            'transfer_reserve' => (bool) ($this->params['transfer_reserve'] ?? false),
            'journal_id' => $this->journal_id,
            'reversal_journal_id' => $this->reversal_journal_id,
            'created_by' => $this->created_by,
            'submitted_by' => $this->submitted_by,
            'approved_by' => $this->approved_by,
            'posted_by' => $this->posted_by,
            'posted_at' => Json::time($this->posted_at),
            'version' => $this->lock_version,
            'lines' => AssetTransactionLineResource::collection($this->whenLoaded('lines')),
            'can' => Json::can($request, $this->resource, ['submit' => 'submit', 'approve' => 'approve', 'return' => 'return', 'void' => 'void', 'reverse' => 'reverse']),
        ];
    }
}
