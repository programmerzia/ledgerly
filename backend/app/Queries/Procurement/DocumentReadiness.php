<?php

declare(strict_types=1);

namespace App\Queries\Procurement;

use App\Domain\Shared\Violation;
use App\Models\Procurement\PurchaseOrder;
use App\Models\Procurement\PurchaseOrderRevision;
use App\Models\Procurement\PurchaseRequisition;
use App\Models\Trade\Contact;
use App\Services\Procurement\RevisionCheck;
use App\Services\Procurement\RevisionPayload;

/** What stops a requisition, order or revision from being submitted. These post nothing, so the ledger's rules do not apply. */
final class DocumentReadiness
{
    public function __construct(private readonly RevisionCheck $revisions, private readonly RevisionPayload $payload) {}

    /** @return list<Violation> */
    public function ofRequisition(PurchaseRequisition $requisition): array
    {
        return $requisition->lines->isEmpty() ? [new Violation('document_lines_missing', 'A requisition needs at least one line.')] : [];
    }

    /** @return list<Violation> */
    public function ofOrder(PurchaseOrder $order): array
    {
        $violations = [];
        if ($order->lines->isEmpty()) {
            $violations[] = new Violation('document_lines_missing', 'An order needs at least one line.');
        }
        if (! (Contact::query()->whereKey($order->contact_id)->value('is_active') ?? false)) {
            $violations[] = new Violation('contact_inactive', 'The supplier is inactive.');
        }

        return $violations;
    }

    /** @return list<Violation> */
    public function ofRevision(PurchaseOrderRevision $revision): array
    {
        return $this->revisions->violations(PurchaseOrder::query()->with('lines')->findOrFail($revision->purchase_order_id), $this->payload->fromProposed($revision));
    }
}
