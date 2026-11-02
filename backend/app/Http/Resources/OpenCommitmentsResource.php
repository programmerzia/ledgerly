<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Http\Support\Json;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Open commitments by supplier and account: what is ordered and not yet billed, net of tax, in the order's currency
 * and in base currency. Reporting only; nothing is posted for it.
 */
final class OpenCommitmentsResource extends JsonResource
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
            /** @var list<array{contact_id: string, contact_name: string, account_id: string, account_code: string, account_name: string, currency: string, open_fc: array{amount: int, currency: string}, open_base: array{amount: int, currency: string}}> */
            'data' => array_map(fn (array $row): array => [
                ...$row,
                'open_fc' => Json::money((int) $row['open_fc'], (string) $row['currency']),
                'open_base' => Json::money((int) $row['open_base'], $base),
            ], $r['rows']),
            'meta' => ['total_base' => Json::money((int) $r['total_base'], $base)],
        ];
    }
}
