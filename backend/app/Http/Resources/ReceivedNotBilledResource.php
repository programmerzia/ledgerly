<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Http\Support\Json;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Goods received and not yet on a posted bill, as of a date: what a manual month-end accrual is worked out from.
 * Valued net of tax at the order price, in the order's currency and in base currency at the order's rate.
 *
 * @mixin \stdClass
 */
final class ReceivedNotBilledResource extends JsonResource
{
    /**
     * @param  array{as_of: string, rows: list<array<string, mixed>>, total_base: int}  $resource
     */
    public function __construct($resource)
    {
        parent::__construct($resource);
    }

    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        $base = Json::baseCurrency($request);
        /** @var array{as_of: string, rows: list<array<string, mixed>>, total_base: int} $r */
        $r = $this->resource;

        return [
            /** @var list<array{purchase_order_id: string, number: string|null, contact_id: string, contact_name: string, order_line_id: string, line_no: int, description: string|null, account_id: string, account_code: string, account_name: string, received: string, billed: string, unbilled: string, currency: string, fx_rate: string, unbilled_fc: array{amount: int, currency: string}, unbilled_base: array{amount: int, currency: string}}> */
            'data' => array_map(fn (array $row): array => [
                ...$row,
                'unbilled_fc' => Json::money((int) $row['unbilled_fc'], (string) $row['currency']),
                'unbilled_base' => Json::money((int) $row['unbilled_base'], $base),
            ], $r['rows']),
            'meta' => ['as_of' => $r['as_of'], 'total_base' => Json::money($r['total_base'], $base)],
        ];
    }
}
