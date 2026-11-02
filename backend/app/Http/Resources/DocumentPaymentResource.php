<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Http\Support\Json;
use App\Models\Trade\CreditApplication;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * One line of a document's payments. `type` says where `id` leads: `settlement` to /settlements/{id}, `credit_application`
 * to /credit-applications/{id}/undo. `number` is the settlement's, or the other document's for a credit.
 *
 * @property array{type: string, id: string, kind: string, number: string|null, date: string, amount_fc: int, amount: int, fx_gain_loss: int, currency: string} $resource
 */
final class DocumentPaymentResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        $r = $this->resource;
        $base = Json::baseCurrency($request);
        $credit = $r['type'] === 'credit_application' ? CreditApplication::query()->find($r['id']) : null;

        return [
            /** @var 'settlement'|'credit_application' */
            'type' => $r['type'],
            /** @var string */
            'id' => $r['id'],
            /** @var string */
            'kind' => $r['kind'],
            /** @var string|null */
            'number' => $r['number'],
            /** @var string */
            'date' => $r['date'],
            'amount_fc' => Json::money((int) $r['amount_fc'], (string) $r['currency']),
            'amount' => Json::money((int) $r['amount'], $base),
            'fx_gain_loss' => Json::money((int) $r['fx_gain_loss'], $base),
            'can' => ['undo' => $credit !== null && (bool) $request->user()?->can('undo', $credit)],
        ];
    }
}
