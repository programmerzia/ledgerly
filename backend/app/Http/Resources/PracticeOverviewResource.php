<?php

declare(strict_types=1);

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Optional;

/**
 * `GET /practice/overview`: the user's client organisations and, within each, the companies they can open, with
 * key figures in each company's own base currency (never summed across companies). `as_of` is when the figures
 * were computed (null = not yet); `switch` is the request that makes the organisation current.
 *
 * @mixin Optional
 */
final class PracticeOverviewResource extends JsonResource
{
    /**
     * @return array{
     *     practices: list<array{
     *         tenant: array{id: string, name: string, slug: string, lifecycle: string},
     *         role: string,
     *         current: bool,
     *         switch: array{method: string, path: string, body: array{tenant_id: string}},
     *         companies: list<array{
     *             id: string, name: string, base_currency: string,
     *             open_ar: array{amount: int, currency: string}, open_ap: array{amount: int, currency: string},
     *             pending_approvals: int, last_closed_period: string|null, period_states: array<string, int>, as_of: string|null
     *         }>
     *     }>
     * }
     */
    public function toArray(Request $request): array
    {
        /** @var array{practices: list<array{tenant: array{id: string, name: string, slug: string, lifecycle: string}, role: string, current: bool, switch: array{method: string, path: string, body: array{tenant_id: string}}, companies: list<array{id: string, name: string, base_currency: string, open_ar: array{amount: int, currency: string}, open_ap: array{amount: int, currency: string}, pending_approvals: int, last_closed_period: string|null, period_states: array<string, int>, as_of: string|null}>}>} $overview */
        $overview = $this->resource;

        return $overview;
    }
}
