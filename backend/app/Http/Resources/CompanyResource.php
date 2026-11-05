<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Models\Organisation\Company;
use App\Support\Formats\CompanyFormats;
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
            /** How this company's dates and numbers read (plan 3c.26b): the chosen format, or its country's usual one. */
            'formats' => $this->formats(),
            // 13 §7: the SPA shows actions from these hints and never re-derives permissions.
            'can' => [
                'open' => (bool) $request->user()?->can('view', $this->resource),
                'manage_settings' => (bool) $request->user()?->can('update', $this->resource),
            ],
        ];
    }

    /** @return array{date: string, number: string} */
    private function formats(): array
    {
        $formats = CompanyFormats::for($this->resource);

        return ['date' => $formats->dateKey, 'number' => $formats->numberKey];
    }
}
