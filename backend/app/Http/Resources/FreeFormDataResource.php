<?php

declare(strict_types=1);

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * `{data: <whatever the Query built>}` for read models whose shape is documented where they are built (numbering overview, budget grid
 * helpers, dashboard note) and that the OpenAPI export can only describe as free-form. Money inside is `{amount, currency}` as everywhere.
 */
final class FreeFormDataResource extends JsonResource
{
    /** @param array<array-key, mixed>|null $resource */
    public function __construct($resource)
    {
        parent::__construct($resource);
    }

    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            /** @var array<string, mixed>|list<array<string, mixed>>|null */
            'data' => $this->resource,
        ];
    }
}
