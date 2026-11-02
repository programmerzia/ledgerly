<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Http\Support\Json;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Order lines with goods still to come, soonest expected first. Quantities are decimal strings.
 */
final class AwaitingReceiptResource extends JsonResource
{
    /**
     * @param  array{rows: list<array<string, mixed>>, total_base: int}  $resource
     */
    public function __construct($resource)
    {
        parent::__construct($resource);
    }

    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        $base = Json::baseCurrency($request);
        /** @var array{rows: list<array<string, mixed>>, total_base: int} $r */
        $r = $this->resource;

        return [
            /** @var list<array{purchase_order_id: string, number: string|null, contact_id: string, contact_name: string, order_date: string, expected_date: string|null, order_line_id: string, line_no: int, description: string|null, item_id: string|null, ordered: string, received: string, open: string, currency: string, open_fc: array{amount: int, currency: string}, open_base: array{amount: int, currency: string}}> */
            'data' => array_map(fn (array $row): array => [
                ...$row,
                'open_fc' => Json::money((int) $row['open_fc'], (string) $row['currency']),
                'open_base' => Json::money((int) $row['open_base'], $base),
            ], $r['rows']),
            'meta' => ['total_base' => Json::money((int) $r['total_base'], $base)],
        ];
    }
}
