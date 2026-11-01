<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Http\Support\Json;
use App\Models\Fx\FxRevaluation;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin FxRevaluation */
final class FxRevaluationResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        /** @var list<array<string, mixed>> $rows */
        $rows = $this->detail['rows'] ?? [];
        /** @var list<array<string, mixed>> $residuals */
        $residuals = $this->detail['residuals'] ?? [];

        return [
            'id' => $this->id,
            'fiscal_period_id' => $this->fiscal_period_id,
            'as_of' => Json::date($this->as_of),
            'status' => $this->status,
            'journal_id' => $this->journal_id,
            'reversal_journal_id' => $this->reversal_journal_id,
            /** True while the automatic reversal is waiting for the next period to exist and be open. */
            'reversal_pending' => $this->isReversalPending(),
            'total_unrealised' => Json::money($this->total_unrealised, $this->base_currency),
            'items' => FxRevaluationPreviewResource::rows($rows, $this->base_currency),
            'residuals' => FxRevaluationPreviewResource::residuals($residuals, $this->base_currency),
            'created_by' => $this->created_by,
        ];
    }
}
