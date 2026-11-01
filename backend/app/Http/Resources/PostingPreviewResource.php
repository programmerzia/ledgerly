<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Domain\Shared\Violation;
use App\Http\Support\Json;
use App\Queries\Ledger\PostingPreview;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin PostingPreview */
final class PostingPreviewResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        $currency = Json::baseCurrency($request);

        return [
            'valid' => $this->valid,
            'violations' => array_map(fn (Violation $v): array => $v->toArray(), $this->violations),
            'period' => $this->periodId === null ? null : ['id' => $this->periodId, 'name' => $this->periodName, 'status' => $this->periodStatus],
            'total_debit' => Json::money($this->totalDebit, $currency),
            'total_credit' => Json::money($this->totalCredit, $currency),
            'number' => null, // assigned gaplessly at posting, never predicted (13 §9)
        ];
    }
}
