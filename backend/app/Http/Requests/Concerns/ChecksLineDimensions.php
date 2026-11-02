<?php

declare(strict_types=1);

namespace App\Http\Requests\Concerns;

use App\Models\Ledger\DimensionValue;
use App\Queries\Ledger\DimensionPositions;
use Illuminate\Contracts\Validation\Validator;

/**
 * Line dimensions as `{"<dimension id>": "<dimension value id>"}` on a request with a `lines` array: each dimension
 * exists in the company and each value belongs to its dimension. For FormRequests that extend CompanyRequest.
 */
trait ChecksLineDimensions
{
    private function checkDimensions(Validator $validator): void
    {
        /** @var list<array<string, mixed>> $lines */
        $lines = array_values((array) $this->input('lines'));
        $known = array_flip((new DimensionPositions)($this->company()->id));

        $valueIds = [];
        foreach ($lines as $i => $line) {
            foreach ((array) ($line['dimensions'] ?? []) as $dimensionId => $valueId) {
                if (! isset($known[(string) $dimensionId])) {
                    $validator->errors()->add("lines.{$i}.dimensions", "Dimension {$dimensionId} does not exist in this company.");
                } elseif (! is_string($valueId)) {
                    $validator->errors()->add("lines.{$i}.dimensions.{$dimensionId}", 'Name a dimension value id.');
                } else {
                    $valueIds[$valueId] = true;
                }
            }
        }
        $found = $valueIds === [] ? [] : DimensionValue::query()->where('company_id', $this->company()->id)->whereIn('id', array_keys($valueIds))->pluck('dimension_id', 'id')->all();
        foreach ($lines as $i => $line) {
            foreach ((array) ($line['dimensions'] ?? []) as $dimensionId => $valueId) {
                if (isset($known[(string) $dimensionId]) && is_string($valueId) && ($found[$valueId] ?? null) !== (string) $dimensionId) {
                    $validator->errors()->add("lines.{$i}.dimensions.{$dimensionId}", 'This value does not belong to the dimension in this company.');
                }
            }
        }
    }

    /**
     * The validated `dimensions` of a line as dimension slot → value id.
     *
     * @param  array<string, mixed>  $line
     * @param  array<string, int>  $slots  dimension id → slot
     * @return array<int, string>
     */
    private function slotted(array $line, array $slots): array
    {
        $dims = [];
        foreach ((array) ($line['dimensions'] ?? []) as $dimensionId => $valueId) {
            $dims[$slots[(string) $dimensionId]] = (string) $valueId;
        }

        return $dims;
    }

    /** @return array<string, int> dimension id → slot */
    private function dimensionSlots(): array
    {
        return array_flip((new DimensionPositions)($this->company()->id));
    }
}
