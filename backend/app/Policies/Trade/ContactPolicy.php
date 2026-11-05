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

    /** The statement run (plan 3c.7a): sends statements for many customers, so it needs the right to send and to read reports. */
    public function runStatements(Authenticatable $principal): bool
    {
        return $this->context->personCan($principal, 'documents.send') && $this->context->personCan($principal, 'reports.view');
    }

    /** Email a statement (plan 3c.5): also needs to read reports, because a statement is one. */
    public function send(Authenticatable $principal, Contact $contact): bool
    {
        return $this->context->personCan($principal, 'documents.send', $contact->company_id)
            && $this->context->personCan($principal, 'reports.view', $contact->company_id)
            && $this->view($principal, $contact);
    }
}
