<?php

declare(strict_types=1);

namespace App\Http\Resources;

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
        ];
    }
}
