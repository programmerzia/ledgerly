<?php

declare(strict_types=1);

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Optional;

/**
 * The signed-in user with their organisations (`GET /me`, `PUT /session/tenant`). Wraps the assembled
 * array; the shape below is the contract.
 *
 * @mixin Optional
 */
final class SessionResource extends JsonResource
{
    /**
     * @return array{
     *     id: string,
     *     name: string,
     *     email: string,
     *     two_factor_enabled: bool,
     *     signing_pin_set: bool,
     *     tenants: list<array{
     *         id: string,
     *         name: string,
     *         slug: string,
     *         lifecycle: string,
     *         role: string,
     *         current: bool,
     *         can: array{manage_members: bool, create_companies: bool}
     *     }>
     * }
     */
    public function toArray(Request $request): array
    {
        /** @var array{id: string, name: string, email: string, two_factor_enabled: bool, signing_pin_set: bool, tenants: list<array{id: string, name: string, slug: string, lifecycle: string, role: string, current: bool, can: array{manage_members: bool, create_companies: bool}}>} $session */
        $session = $this->resource;

        return $session;
    }
}
