<?php

declare(strict_types=1);

namespace App\Policies\Trade;

use App\Models\Trade\CreditApplication;
use App\Policies\PolicyContext;
use Illuminate\Contracts\Auth\Authenticatable;

/** Undoing an application is a reversal of money already moved between documents: people with `receipts.reverse` / `payments.reverse`. */
final class CreditApplicationPolicy
{
    public function __construct(private readonly PolicyContext $context) {}

    public function undo(Authenticatable $principal, CreditApplication $a): bool
    {
        return $a->reversed_at === null
            && ($this->context->personCan($principal, 'receipts.reverse', $a->company_id) || $this->context->personCan($principal, 'payments.reverse', $a->company_id));
    }
}
