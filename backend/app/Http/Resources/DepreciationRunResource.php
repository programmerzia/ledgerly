<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Http\Support\Json;
use App\Models\FixedAssets\DepreciationRun;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A depreciation run. Money is in the base currency. Each line is one asset's charge for the run, with the months it covers
 * and, when earlier months were skipped, how many of them are catch-up.
 *
 * @mixin DepreciationRun
 */
final class DepreciationRunResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        $cur = Json::baseCurrency($request);

        return [
            'id' => $this->id,
            'number' => $this->number,
            'status' => $this->status->value,
            'fiscal_period_id' => $this->fiscal_period_id,
            'as_of' => Json::date($this->as_of),
            'total' => Json::money($this->total, $cur),
            'journal_id' => $this->journal_id,
            'reversal_journal_id' => $this->reversal_journal_id,
            'memo' => $this->memo,
            'created_by' => $this->created_by,
            'submitted_by' => $this->submitted_by,
            'approved_by' => $this->approved_by,
            'posted_by' => $this->posted_by,
            'posted_at' => Json::time($this->posted_at),
            'version' => $this->lock_version,
            'lines' => DepreciationRunLineResource::collection($this->whenLoaded('lines')),
            'can' => Json::can($request, $this->resource, ['submit' => 'submit', 'approve' => 'approve', 'return' => 'return', 'void' => 'void', 'reverse' => 'reverse']),
        ];
    }
}
