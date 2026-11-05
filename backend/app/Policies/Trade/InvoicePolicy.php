<?php

declare(strict_types=1);

namespace App\Policies\Trade;

use App\Domain\Trade\InvoiceKind;
use App\Domain\Workflow\DocumentStatus;
use App\Models\Platform\User;
use App\Models\Trade\Invoice;
use App\Policies\PolicyContext;
use Illuminate\Contracts\Auth\Authenticatable;

/**
 * Invoices and credit notes (`invoices.*`, tokens `invoices:read|write|submit`) and bills and debit notes
 * (`bills.*`, `bills:read|write|submit`), by the document's kind (13 §7). Permission + state + relationship to
 * the actor; the Actions check again. Maker ≠ checker: whoever created or submitted a document never approves
 * it. API clients read, draft and submit; approving, returning and reversing are for people. Voiding: the creator
 * or an approver; the Sales Assistant's `invoices.void_own` covers her own drafts only.
 */
final class InvoicePolicy
{
    public function __construct(private readonly PolicyContext $context) {}

    public function viewAnyInvoices(Authenticatable $principal): bool
    {
        return $this->context->can($principal, 'invoices.view', 'invoices:read');
    }

    public function viewAnyBills(Authenticatable $principal): bool
    {
        return $this->context->can($principal, 'bills.view', 'bills:read');
    }

    public function createInvoice(Authenticatable $principal): bool
    {
        return $this->context->can($principal, 'invoices.create', 'invoices:write');
    }

    public function createBill(Authenticatable $principal): bool
    {
        return $this->context->can($principal, 'bills.create', 'bills:write');
    }

    public function view(Authenticatable $principal, Invoice $invoice): bool
    {
        return $this->context->can($principal, $this->module($invoice).'.view', $this->module($invoice).':read', $invoice->company_id);
    }

    public function update(Authenticatable $principal, Invoice $invoice): bool
    {
        return $invoice->status === DocumentStatus::Draft
            && $this->context->can($principal, $this->module($invoice).'.create', $this->module($invoice).':write', $invoice->company_id);
    }

    public function submit(Authenticatable $principal, Invoice $invoice): bool
    {
        return $invoice->status === DocumentStatus::Draft
            && $this->context->can($principal, $this->module($invoice).'.submit', $this->module($invoice).':submit', $invoice->company_id);
    }

    public function approve(Authenticatable $principal, Invoice $invoice): bool
    {
        return $principal instanceof User
            && $invoice->status === DocumentStatus::PendingApproval
            && ! in_array($principal->id, [$invoice->created_by, $invoice->submitted_by], true)
            && $this->context->allows($principal, $this->module($invoice).'.approve', $invoice->company_id);
    }

    public function return(Authenticatable $principal, Invoice $invoice): bool
    {
        return $this->approve($principal, $invoice);
    }

    public function void(Authenticatable $principal, Invoice $invoice): bool
    {
        if (! in_array($invoice->status, [DocumentStatus::Draft, DocumentStatus::PendingApproval], true)) {
            return false;
        }
        $module = $this->module($invoice);
        $own = $invoice->created_by === $principal->getAuthIdentifier();
        if (! $principal instanceof User) {
            return $own && $this->context->can($principal, "{$module}.create", "{$module}:write", $invoice->company_id);
        }

        $approver = $this->context->allows($principal, "{$module}.approve", $invoice->company_id);
        if (! $own && ! $approver) {
            return false;
        }

        return $approver
            || $this->context->allows($principal, "{$module}.void", $invoice->company_id)
            || ($invoice->status === DocumentStatus::Draft && $this->context->allows($principal, "{$module}.void_own", $invoice->company_id));
    }

    /** Whether anything was settled is the Action's call (`invoice_has_settlements`), so the client sees why. */
    public function reverse(Authenticatable $principal, Invoice $invoice): bool
    {
        return $invoice->status === DocumentStatus::Posted
            && $this->context->personCan($principal, $this->module($invoice).'.reverse', $invoice->company_id);
    }

    /** Email a sales document (plan 3c.5): the route asks for the right; whether it is posted is the Action's call, so the client sees why. */
    public function send(Authenticatable $principal, Invoice $invoice): bool
    {
        return $invoice->kind->isSales() && $this->context->personCan($principal, 'documents.send', $invoice->company_id)
            && $this->view($principal, $invoice);
    }

    /** Submit this draft bill past a purchase order mismatch, with a reason (13 §10). People only, and never its own maker. */
    public function overrideMatch(Authenticatable $principal, Invoice $invoice): bool
    {
        return $invoice->status === DocumentStatus::Draft && $invoice->kind === InvoiceKind::PurchaseBill
            && ! in_array($principal->getAuthIdentifier(), [$invoice->created_by, $invoice->submitted_by], true)
            && $this->context->personCan($principal, 'bills.match_override', $invoice->company_id);
    }

    /** Apply a posted credit note (`/invoices`) or debit note (`/bills`) to an open document of the same contact. */
    public function allocate(Authenticatable $principal, Invoice $invoice): bool
    {
        return $invoice->status === DocumentStatus::Posted && $invoice->kind->isNote()
            && $this->context->personCan($principal, ($invoice->kind->isSales() ? 'receipts' : 'payments').'.create', $invoice->company_id);
    }

    private function module(Invoice $invoice): string
    {
        return $invoice->kind->documentType().'s';
    }
}
