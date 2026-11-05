<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Queries\Ledger\ChartTemplateSummary;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin ChartTemplateSummary */
final class ChartTemplateResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'code' => $this->code,
            'name' => $this->name,
            'country' => $this->country,
            'standard' => $this->standard,
            'account_count' => $this->accountCount,
            'recommended' => $this->recommended,
        ];
    }
}
