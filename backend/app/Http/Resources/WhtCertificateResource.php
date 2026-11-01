<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Http\Support\Json;
use App\Models\Trade\WhtCertificate;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Amounts are base currency. `payment_id` is the settlement that withheld, `invoice_id` the bill; `status` is `void` once the payment is reversed.
 *
 * @mixin WhtCertificate
 */
final class WhtCertificateResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        $base = Json::baseCurrency($request);

        return [
            'id' => $this->id,
            'number' => $this->number,
            'status' => $this->status,
            'payment_id' => $this->payment_id,
            'invoice_id' => $this->invoice_id,
            'contact_id' => $this->contact_id,
            'tax_code_id' => $this->tax_code_id,
            'base_amount' => Json::money($this->base_amount, $base),
            'wht_amount' => Json::money($this->wht_amount, $base),
            'issued_on' => Json::date($this->issued_on),
        ];
    }
}
