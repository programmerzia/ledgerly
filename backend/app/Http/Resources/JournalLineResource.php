<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Http\Support\Json;
use App\Models\Ledger\JournalLine;
use App\Queries\Ledger\DimensionPositions;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin JournalLine */
final class JournalLineResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        $currency = Json::baseCurrency($request);

        return [
            'line_no' => $this->line_no,
            'account_id' => $this->account_id,
            'debit' => Json::money($this->debit, $currency),
            'credit' => Json::money($this->credit, $currency),
            // Foreign-currency lines: the signed amount in that currency (+debit / -credit) and the rate to base.
            'currency' => $this->currency,
            'fx_rate' => (string) $this->fx_rate,
            'amount_fc' => Json::money($this->amount_fc, $this->currency),
            'description' => $this->description,
            /** @var array<string, string> dimension id → dimension value id */
            'dimensions' => (object) $this->dimensions($request),
            'contact_id' => $this->contact_id,
            'tax_code_id' => $this->tax_code_id,
            'due_date' => $this->due_date,
        ];
    }

    /** @return array<string, string> */
    private function dimensions(Request $request): array
    {
        $out = [];
        foreach ($this->positions($request) as $position => $dimensionId) {
            $valueId = $this->resource->getAttribute("dim{$position}_value_id");
            if (is_string($valueId)) {
                $out[$dimensionId] = $valueId;
            }
        }

        return $out;
    }

    /**
     * Slot → dimension id, read once per request: a journal's lines all share it.
     *
     * @return array<int, string>
     */
    private function positions(Request $request): array
    {
        /** @var array<int, string>|null $cached */
        $cached = $request->attributes->get('dimension_positions');
        if ($cached === null) {
            $cached = (new DimensionPositions)(Json::company($request)->id);
            $request->attributes->set('dimension_positions', $cached);
        }

        return $cached;
    }
}
