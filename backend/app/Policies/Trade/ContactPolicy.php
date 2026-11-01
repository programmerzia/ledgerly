<?php

declare(strict_types=1);

namespace App\Policies\Trade;

use App\Models\Trade\Contact;
use App\Policies\PolicyContext;
use Illuminate\Contracts\Auth\Authenticatable;

/**
 * Customers and suppliers (13 §7). Tokens: `contacts:read` and `contacts:write`. A Sales Assistant holds
 * `contacts.manage_customers` and so manages customers only; `contacts.manage` covers every kind.
 */
final class ContactPolicy
{
    public function __construct(private readonly PolicyContext $context) {}

    public function viewAny(Authenticatable $principal): bool
    {
        return $this->context->can($principal, 'contacts.view', 'contacts:read');
    }

    public function view(Authenticatable $principal, Contact $contact): bool
    {
        return $this->context->can($principal, 'contacts.view', 'contacts:read', $contact->company_id);
    }

    /** Whether to create is asked before the kind is known; the Action checks the kind. */
    public function create(Authenticatable $principal): bool
    {
        return $this->context->can($principal, 'contacts.manage_customers', 'contacts:write');
    }

    public function update(Authenticatable $principal, Contact $contact): bool
    {
        return $this->context->can($principal, $contact->kind === 'customer' ? 'contacts.manage_customers' : 'contacts.manage', 'contacts:write', $contact->company_id);
    }

    public function deactivate(Authenticatable $principal, Contact $contact): bool
    {
        return $contact->is_active && $this->update($principal, $contact);
    }
}
