<?php

declare(strict_types=1);

namespace App\Actions\Procurement;

use App\Actions\Ledger\SetupGuard;
use App\Actions\Procurement\Inputs\RevisionInput;
use App\Domain\Procurement\RevisionStatus;
use App\Domain\Shared\DomainRuleViolation;
use App\Models\Procurement\PurchaseOrder;
use App\Models\Procurement\PurchaseOrderRevision;
use App\Services\Procurement\RevisionPayload;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;

/** Changes a draft revision (also one that was returned), guarded by its lock_version. */
final class UpdateOrderRevision
{
    public function __construct(private readonly UnitOfWork $uow, private readonly SetupGuard $guard, private readonly RevisionPayload $payload) {}

    public function handle(Actor $actor, string $revisionId, int $lockVersion, RevisionInput $in): PurchaseOrderRevision
    {
        if (trim($in->reason) === '') {
            throw DomainRuleViolation::single('comment_required', 'Say why the order is being revised.');
        }

        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $revisionId, $lockVersion, $in) {
            $seen = PurchaseOrderRevision::query()->findOrFail($revisionId);
            $this->guard->require($actor, 'purchase_orders.create', $seen->company_id, tokens: true);
            $revision = $locks->document($seen, $lockVersion);
            if ($revision->status !== RevisionStatus::Draft) {
                throw DomainRuleViolation::single('document_not_editable', 'Only a draft revision can be edited.');
            }
            $order = PurchaseOrder::query()->findOrFail($revision->purchase_order_id);

            $computed = $this->payload->price($order, $in);
            $before = $revision->attributesToArray();
            $revision->forceFill([
                'reason' => $in->reason, 'proposed' => $this->payload->toProposed($in, $computed), 'total' => $computed->total, 'lock_version' => $revision->lock_version + 1,
            ])->save();

            $audit->add('purchase_order_revision.updated', $revision, before: $before, after: $revision);

            return $revision;
        });
    }
}
