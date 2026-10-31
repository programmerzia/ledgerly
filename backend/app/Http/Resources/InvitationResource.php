<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Models\Organisation\Invitation;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin Invitation */
final class InvitationResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'email' => $this->email,
            'role' => $this->role,
            'company_role' => $this->company_role,
            'company_ids' => $this->company_ids ?? [],
            'invited_by' => $this->invited_by,
            'expires_at' => $this->expires_at->toIso8601String(),
        ];
    }
}
