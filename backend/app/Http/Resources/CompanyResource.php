<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Models\Organisation\Company;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin Company */
final class CompanyResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'legal_name' => $this->legal_name,
            'slug' => $this->slug,
            'country' => $this->country,
            'base_currency' => $this->base_currency,
            'fiscal_year_start_month' => $this->fiscal_year_start_month,
            'tax_id' => $this->tax_id,
            'timezone' => $this->timezone,
            'status' => $this->status,
        ];
    }
}
