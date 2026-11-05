<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Domain\Organisation\PermissionMatrix;
use App\Models\Organisation\Role;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin Role */
final class RoleResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'permissions' => $this->permissions->pluck('name')->sort()->values()->all(),
            'members' => (int) $this->getAttribute('members_count'),
            // Plan 3c.25: a standard role keeps its name, Owner is locked completely, an edited standard role can be reset.
            'system' => $this->is_system,
            'locked' => $this->is_system && $this->name === PermissionMatrix::OWNER,
            'edited' => $this->permissions_edited,
        ];
    }
}
