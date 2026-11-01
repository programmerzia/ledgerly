<?php

declare(strict_types=1);

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Optional;

/**
 * What an invitation link is for, shown before sign-in (`GET /invitation-tokens/{token}`).
 *
 * @mixin Optional
 */
final class InvitationPreviewResource extends JsonResource
{
    /**
     * @return array{
     *     organisation: string,
     *     email: string,
     *     role: string,
     *     company_role: string|null,
     *     status: 'open'|'accepted'|'revoked'|'expired',
     *     expires_at: string,
     *     account_exists: bool
     * }
     */
    public function toArray(Request $request): array
    {
        /** @var array{organisation: string, email: string, role: string, company_role: string|null, status: 'open'|'accepted'|'revoked'|'expired', expires_at: string, account_exists: bool} $preview */
        $preview = $this->resource;

        return $preview;
    }
}
