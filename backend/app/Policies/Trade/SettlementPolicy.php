<?php

declare(strict_types=1);

namespace App\Policies\Trade;

use App\Domain\Workflow\DocumentStatus;
use App\Models\Platform\User;
use App\Models\Trade\Settlement;
use App\Policies\PolicyContext;
use Illuminate\Contracts\Auth\Authenticatable;

/**
 * Receipts, payments and refunds (`receipts.*` for receipts, `payments.*` for the others; tokens `settlements:read|write|submit`)
 * (13 §7). Submitting and returning follow `.create` (the matrix has no `.submit` for them) and approving, returning and voiding
 * follow `payments.approve`. Maker ≠ checker. API clients read, draft and submit; approving, reversing and applying credit are for people.
 */
final class SettlementPolicy
{
    public function __construct(private readonly PolicyContext $context) {}

    public function viewAny(Authenticatable $principal): bool
    {
        return $this->context->can($principal, 'receipts.view', 'settlements:read') || $this->context->can($principal, 'payments.view', 'settlements:read');
    }

    public function create(Authenticatable $principal): bool
    {
        return $this->context->can($principal, 'receipts.create', 'settlements:write') || $this->context->can($principal, 'payments.create', 'settlements:write');
    }

    public function view(Authenticatable $principal, Settlement $s): bool
    {
        return $this->context->can($principal, $s->module().'.view', 'settlements:read', $s->company_id);
    }

    public function update(Authenticatable $principal, Settlement $s): bool
    {
        return $s->status === DocumentStatus::Draft && $this->context->can($principal, $s->module().'.create', 'settlements:write', $s->company_id);
    }

    public function submit(Authenticatable $principal, Settlement $s): bool
    {
        return $s->status === DocumentStatus::Draft && $this->context->can($principal, $s->module().'.create', 'settlements:submit', $s->company_id);
    }

    public function approve(Authenticatable $principal, Settlement $s): bool
    {
        return $principal instanceof User
            && $s->status === DocumentStatus::PendingApproval
            && ! in_array($principal->id, [$s->created_by, $s->submitted_by], true)
            && $this->context->allows($principal, 'payments.approve', $s->company_id);
    }

    public function return(Authenticatable $principal, Settlement $s): bool
    {
        return $this->approve($principal, $s);
    }

    public function void(Authenticatable $principal, Settlement $s): bool
    {
        if (! in_array($s->status, [DocumentStatus::Draft, DocumentStatus::PendingApproval], true)) {
            return false;
        }
        $own = $s->created_by === $principal->getAuthIdentifier();
        if (! $principal instanceof User) {
            return $own && $this->context->can($principal, $s->module().'.create', 'settlements:write', $s->company_id);
        }

        return ($own && $this->context->allows($principal, $s->module().'.create', $s->company_id))
            || $this->context->allows($principal, 'payments.approve', $s->company_id);
    }

    /** Whether it can be reversed (credit applied elsewhere, ...) is the Action's call, so the client sees why. */
    public function reverse(Authenticatable $principal, Settlement $s): bool
    {
        return $s->status === DocumentStatus::Posted && $this->context->personCan($principal, $s->module().'.reverse', $s->company_id);
    }

    /** Email a payment advice (plan 3c.5); whether it is a payment and posted is the Action's call. */
    public function send(Authenticatable $principal, Settlement $s): bool
    {
        return $this->context->personCan($principal, 'documents.send', $s->company_id) && $this->view($principal, $s);
    }

    /** Apply the credit on account of a posted receipt or payment to an open document. */
    public function allocate(Authenticatable $principal, Settlement $s): bool
    {
        return $s->status === DocumentStatus::Posted && in_array($s->kind, ['receipt', 'payment'], true)
            && $this->context->personCan($principal, $s->module().'.create', $s->company_id);
    }
}
