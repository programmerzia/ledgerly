<?php

declare(strict_types=1);

namespace App\Http\Requests\Sharing;

use App\Http\Requests\CompanyRequest;
use App\Services\Sharing\InvoiceLinkAccess;

/** Make an online link; it can be given a lifetime in days, or none. */
final class CreateInvoiceLinkRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            /** Days the link works for (1 to 365); empty: until revoked. */
            'expires_in_days' => ['nullable', 'integer', 'between:1,'.InvoiceLinkAccess::MAX_EXPIRY_DAYS],
        ];
    }

    public function expiresInDays(): ?int
    {
        $v = $this->validated();

        return isset($v['expires_in_days']) ? (int) $v['expires_in_days'] : null;
    }
}
