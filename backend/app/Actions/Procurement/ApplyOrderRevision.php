<?php

declare(strict_types=1);

namespace App\Actions\Procurement;

use App\Contracts\Clock;
use App\Contracts\IdGenerator;
use App\Domain\Ledger\PostingRejected;
use App\Domain\Procurement\PurchaseOrderStatus;
use App\Domain\Procurement\RevisionStatus;
use App\Domain\Shared\DomainRuleViolation;
use App\Events\Procurement\ProcurementEvent;
use App\Models\Procurement\PurchaseOrder;
use App\Models\Procurement\PurchaseOrderLine;
use App\Models\Procurement\PurchaseOrderRevision;
use App\Queries\Procurement\OrderLineFigures;
use App\Services\Procurement\OrderWriter;
use App\Services\Procurement\RevisionCheck;
use App\Services\Procurement\RevisionPayload;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;

/**
 * The last approval of a revision has been given: its proposal becomes the order. Revision, then order (13 §8). Checked again
 * under the order's lock, because receipts and bills may have moved on while it waited. Line ids survive, so receipts and
 * bills stay attached. The revision keeps the order as it was and as it became, which is how every version stays visible.
 */
final class ApplyOrderRevision
{
    public function __construct(
        private readonly UnitOfWork $uow,
        private readonly RevisionPayload $payload,
        private readonly RevisionCheck $check,
        private readonly OrderWriter $writer,
        private readonly OrderLineFigures $figures,
        private readonly IdGenerator $ids,
        private readonly Clock $clock,
    ) {}

    public function handle(Actor $actor, string $revisionId): PurchaseOrderRevision
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $revisionId) {
            $revision = $locks->document(PurchaseOrderRevision::query()->findOrFail($revisionId));
            if (! in_array($revision->status, [RevisionStatus::Draft, RevisionStatus::PendingApproval], true)) {
                throw DomainRuleViolation::single('document_not_postable', "A {$revision->status->value} revision cannot be applied.");
            }
            $order = $locks->document(PurchaseOrder::query()->findOrFail($revision->purchase_order_id))->load('lines');
            $in = $this->payload->fromProposed($revision);
            $violations = $this->check->violations($order, $in);
            if ($violations !== []) {
                throw PostingRejected::because($violations);
            }

            $computed = $this->payload->price($order, $in);
            $before = $order->documentContent();
            $beforeAttributes = $order->attributesToArray();

            $kept = array_values(array_filter(array_map(fn ($l) => $l->id, $in->lines)));
            PurchaseOrderLine::query()->where('purchase_order_id', $order->id)->whereNotIn('id', $kept)->delete();
            $next = (int) ($order->lines->max('line_no') ?? 0);
            $lineNos = [];
            foreach ($computed->lines as $i => $line) {
                $id = $in->lines[$i]->id;
                $columns = $this->writer->lineColumns($line);
                if ($id !== null) {
                    PurchaseOrderLine::query()->whereKey($id)->update($columns);
                    $lineNos[] = $id;

                    continue;
                }
                (new PurchaseOrderLine)->forceFill([
                    'id' => $this->ids->next(), 'tenant_id' => $actor->tenantId, 'company_id' => $order->company_id, 'purchase_order_id' => $order->id,
                    'line_no' => ++$next, ...$columns,
                ])->save();
            }

            $revisionNo = $order->revision + 1;
            $order->forceFill([
                ...$this->writer->totals($computed),
                'expected_date' => $in->expectedDate, 'reference' => $in->reference, 'memo' => $in->memo,
                'revision' => $revisionNo,
                'status' => PurchaseOrderStatus::fromQuantities(array_values($this->figures->forOrder($order->id))),
                'lock_version' => $order->lock_version + 1,
            ])->save();
            $order->load('lines');

            $revision->forceFill([
                'status' => RevisionStatus::Applied, 'revision_no' => $revisionNo, 'before' => $before, 'after' => $order->documentContent(),
                'applied_at' => $this->clock->now(), 'lock_version' => $revision->lock_version + 1,
            ])->save();

            $audit->add('purchase_order.revised', $order, before: $beforeAttributes, after: $order, context: ['revision_id' => $revision->id, 'revision' => $revisionNo, 'reason' => $revision->reason]);
            $outbox->add(new ProcurementEvent('purchase_order.revised', $order->id, $order->company_id, $order->lock_version, ['number' => $order->number, 'revision' => $revisionNo]));

            return $revision;
        });
    }
}
