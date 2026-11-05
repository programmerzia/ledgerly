<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Http\Support\Json;
use App\Models\Trade\Contact;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin Contact
 *
 * `balances` (on the list and on one contact) are the open receivable and payable from posted documents, in base currency
 * (Queries\Trade\ContactBalances). They are absent where the resource is rendered without them (after a write).
 */
final class ContactResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'kind' => $this->kind,
            'code' => $this->code,
            'name' => $this->name,
            'legal_name' => $this->legal_name,
            'tax_id' => $this->tax_id,
            'email' => $this->email,
            'phone' => $this->phone,
            'billing_address' => $this->billing_address,
            'shipping_address' => $this->shipping_address,
            'default_currency' => $this->default_currency,
            'payment_terms_days' => $this->payment_terms_days,
            'credit_limit' => $this->credit_limit === null ? null : Json::money($this->credit_limit, $this->default_currency),
            'ar_account_id' => $this->ar_account_id,
            'ap_account_id' => $this->ap_account_id,
            'wht_code_id' => $this->wht_code_id,
            'default_account_id' => $this->default_account_id,
            'default_tax_code_id' => $this->default_tax_code_id,
            'default_branch' => $this->default_branch,
            /** @var array<string, string> dimension id → dimension value id */
            'default_dims' => (object) ($this->default_dims ?? []),
            'is_active' => $this->is_active,
            'notes' => $this->notes,
            'balances' => $this->when(array_key_exists('open_balances', $this->resource->getAttributes()), fn (): array => [
                'receivable' => Json::money((int) $this->resource->getAttributes()['open_balances']['receivable'], Json::baseCurrency($request)),
                'payable' => Json::money((int) $this->resource->getAttributes()['open_balances']['payable'], Json::baseCurrency($request)),
            ]),
            'version' => $this->lock_version,
            'can' => Json::can($request, $this->resource, ['update' => 'update', 'deactivate' => 'deactivate', 'send' => 'send']),
        ];
    }
}
