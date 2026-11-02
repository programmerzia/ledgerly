<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Models\Platform\TenantUser;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A person in the organisation: org role (owner | admin | member), status, and company roles by company id.
 *
 * @mixin TenantUser
 */
final class MemberResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'user_id' => $this->user_id,
            'name' => (string) $this->getAttribute('name'),
            'email' => (string) $this->getAttribute('email'),
            'role' => $this->role,
            'status' => $this->status,
            'company_roles' => $this->getAttribute('company_roles'),
        ];
    }
}
