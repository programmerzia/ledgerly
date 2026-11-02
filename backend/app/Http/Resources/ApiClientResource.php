<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Http\Support\Json;
use App\Models\Organisation\ApiClient;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * An integrator principal and its tokens (never their secrets). The plain token of the call that created one is added
 * once, as `token`, by `revealing()`.
 *
 * @mixin ApiClient
 */
final class ApiClientResource extends JsonResource
{
    private ?string $plainToken = null;

    public function revealing(string $plainToken): self
    {
        $this->plainToken = $plainToken;

        return $this;
    }

    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'company_ids' => $this->company_ids,
            'created_by' => $this->created_by,
            'last_used_at' => Json::time($this->last_used_at),
            'revoked_at' => Json::time($this->revoked_at),
            'is_active' => $this->revoked_at === null,
            'tokens' => $this->tokenRows(),
            'token' => $this->when($this->plainToken !== null, fn (): string => (string) $this->plainToken),
            'can' => Json::can($request, $this->resource, ['revoke' => 'revoke', 'issue_token' => 'revoke']),
        ];
    }

    /** @return list<array{name: string, abilities: list<string>, last_used_at: string|null, expires_at: string|null, created_at: string|null}> */
    private function tokenRows(): array
    {
        $rows = [];
        foreach ($this->tokens as $t) {
            $rows[] = [
                'name' => (string) $t->name, 'abilities' => array_values(array_map('strval', (array) $t->abilities)),
                'last_used_at' => Json::time($t->last_used_at), 'expires_at' => Json::time($t->expires_at), 'created_at' => Json::time($t->created_at),
            ];
        }

        return $rows;
    }
}
