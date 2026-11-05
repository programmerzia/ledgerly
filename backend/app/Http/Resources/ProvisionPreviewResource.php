<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Http\Support\Json;
use App\Queries\Transactions\ProvisionPreview;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * What a provisioning run for a date would be, nothing saved: receivables by aging bucket with the rate and the allowance each needs,
 * the allowance required, the allowance held, and the signed difference a run would post. Base currency.
 *
 * @mixin ProvisionPreview
 */
final class ProvisionPreviewResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        $base = Json::baseCurrency($request);

        return [
            'as_of' => $this->asOf,
            'buckets' => ProvisionRunResource::buckets($this->rows, $base),
            'required' => Json::money($this->required, $base),
            'existing' => Json::money($this->existing, $base),
            'difference' => Json::money($this->difference, $base),
        ];
    }
}
