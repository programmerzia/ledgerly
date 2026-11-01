<?php

declare(strict_types=1);

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Optional;

/**
 * A signing-PIN grant after `POST /signing/verify`: granted, until when (RFC 3339).
 *
 * @mixin Optional
 */
final class SigningGrantResource extends JsonResource
{
    /** @return array{granted: bool, expires_at: string} */
    public function toArray(Request $request): array
    {
        /** @var array{granted: bool, expires_at: string} $grant */
        $grant = $this->resource;

        return $grant;
    }
}
