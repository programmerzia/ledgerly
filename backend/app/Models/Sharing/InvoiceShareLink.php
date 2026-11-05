<?php

declare(strict_types=1);

namespace App\Models\Sharing;

use App\Models\BaseModel;
use Carbon\CarbonImmutable;

/**
 * An online link to one posted invoice. Only the SHA-256 of the token is stored; the token itself is shown once, when the link is made.
 *
 * @property string $id
 * @property string $tenant_id
 * @property string $company_id
 * @property string $invoice_id
 * @property string $token_hash
 * @property string $channel manual | email
 * @property string|null $created_by
 * @property CarbonImmutable|null $expires_at
 * @property CarbonImmutable|null $revoked_at
 * @property string|null $revoked_by
 * @property int $view_count
 * @property CarbonImmutable|null $last_viewed_at
 * @property CarbonImmutable $created_at
 */
class InvoiceShareLink extends BaseModel
{
    protected $hidden = ['token_hash'];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'expires_at' => 'immutable_datetime', 'revoked_at' => 'immutable_datetime', 'last_viewed_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime', 'view_count' => 'integer',
        ];
    }

    /** active, expired or revoked, as of $now. */
    public function statusAt(\DateTimeInterface $now): string
    {
        return match (true) {
            $this->revoked_at !== null => 'revoked',
            $this->expires_at !== null && $this->expires_at <= $now => 'expired',
            default => 'active',
        };
    }
}
