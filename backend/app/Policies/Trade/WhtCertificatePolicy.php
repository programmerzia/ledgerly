<?php

declare(strict_types=1);

namespace App\Policies\Trade;

use App\Models\Trade\WhtCertificate;
use App\Policies\PolicyContext;
use Illuminate\Contracts\Auth\Authenticatable;

/** WHT certificates are issued by the payment that settles the bill; they can only be read (`payments.view`, token `settlements:read`). */
final class WhtCertificatePolicy
{
    public function __construct(private readonly PolicyContext $context) {}

    public function viewAny(Authenticatable $principal): bool
    {
        return $this->context->can($principal, 'payments.view', 'settlements:read');
    }

    public function view(Authenticatable $principal, WhtCertificate $c): bool
    {
        return $this->context->can($principal, 'payments.view', 'settlements:read', $c->company_id);
    }
}
