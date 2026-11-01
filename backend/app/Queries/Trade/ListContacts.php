<?php

declare(strict_types=1);

namespace App\Queries\Trade;

use App\Models\Trade\Contact;
use Illuminate\Database\Eloquent\Builder;

/** The company's contacts, filtered; the caller paginates (by code). `kind=customer` also returns contacts that are both. */
final class ListContacts
{
    /** @return Builder<Contact> */
    public function __invoke(string $companyId, ?string $kind = null, ?bool $active = null, ?string $search = null): Builder
    {
        $query = Contact::query()->where('company_id', $companyId);
        if ($kind !== null) {
            $query->whereIn('kind', $kind === 'both' ? ['both'] : [$kind, 'both']);
        }
        if ($active !== null) {
            $query->where('is_active', $active);
        }
        if ($search !== null && trim($search) !== '') {
            $like = '%'.addcslashes(trim($search), '\\%_').'%';
            $query->where(fn (Builder $q) => $q->where('code', 'ilike', $like)->orWhere('name', 'ilike', $like)
                ->orWhere('legal_name', 'ilike', $like)->orWhere('email', 'ilike', $like)->orWhere('tax_id', 'ilike', $like));
        }

        return $query;
    }
}
