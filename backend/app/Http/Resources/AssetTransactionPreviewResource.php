<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Http\Support\Json;
use App\Queries\FixedAssets\AssetPreviewJournalLine;
use App\Queries\FixedAssets\AssetPreviewLine;
use App\Queries\FixedAssets\AssetTransactionPreviewData;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * What a disposal, impairment, reversal or revaluation would do. `gain_or_loss` is positive for a gain; `to_reserve` and
 * `to_profit_or_loss` apply to revaluations (and impairments of revalued assets); `cap` is the most an impairment reversal can be.
 *
 * @mixin AssetTransactionPreviewData
 */
final class AssetTransactionPreviewResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        $cur = Json::baseCurrency($request);
        $money = static fn (?int $v): ?array => $v === null ? null : Json::money($v, $cur);

        return [
            'kind' => $this->kind,
            'tx_date' => $this->txDate,
            'total' => Json::money($this->total, $cur),
            'assets' => array_map(fn (AssetPreviewLine $a): array => [
                'asset_id' => $a->assetId, 'asset_number' => $a->assetNumber, 'asset_name' => $a->assetName,
                'carrying_before' => Json::money($a->carryingBefore, $cur), 'carrying_after' => Json::money($a->carryingAfter, $cur),
                'gain_or_loss' => $money($a->gainOrLoss), 'to_reserve' => $money($a->toReserve), 'to_profit_or_loss' => $money($a->toProfitOrLoss), 'cap' => $money($a->cap),
                'journal_lines' => array_map(fn (AssetPreviewJournalLine $l): array => [
                    'account_code' => $l->accountCode, 'account_name' => $l->accountName, 'debit' => Json::money($l->debit, $cur), 'credit' => Json::money($l->credit, $cur),
                ], $a->journalLines),
            ], $this->assets),
        ];
    }
}
