<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Contracts\Clock;
use App\Http\Support\Json;
use App\Models\Platform\User;
use App\Models\Sharing\InvoiceShareLink;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * An online link as its issuer sees it. The address is never part of it: only the token's hash is stored.
 *
 * @mixin InvoiceShareLink
 */
final class InvoiceShareLinkResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        $by = $this->created_by === null ? null : User::query()->whereKey($this->created_by)->value('name');

        return [
            'id' => $this->id,
            /** active, expired or revoked */
            'status' => $this->statusAt(app(Clock::class)->now()),
            /** manual (made on the invoice page) or email (made when an email with the link went out) */
            'channel' => $this->channel,
            'created_at' => Json::time($this->created_at),
            /** @var string|null */
            'created_by_name' => is_string($by) ? $by : null,
            'expires_at' => Json::time($this->expires_at),
            'revoked_at' => Json::time($this->revoked_at),
            /** How many times the page or its PDF was opened. */
            'view_count' => $this->view_count,
            'last_viewed_at' => Json::time($this->last_viewed_at),
        ];
    }
}
