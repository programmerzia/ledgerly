<?php

declare(strict_types=1);

namespace App\Services\Procurement;

use App\Contracts\Clock;
use App\Contracts\IdGenerator;
use App\Contracts\PermissionChecker;
use App\Domain\Shared\DomainRuleViolation;
use App\Domain\Shared\Violation;
use App\Events\Procurement\ProcurementEvent;
use App\Models\Procurement\BillMatchResult;
use App\Models\Procurement\PurchaseOrder;
use App\Models\Procurement\PurchaseOrderLine;
use App\Models\Trade\Invoice;
use App\Support\Actor;
use App\Support\ActorType;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;

/**
 * The three-way match at bill submit (13 §10). The caller holds the bill's lock; this takes its orders' locks (rank above
 * invoices, by id) before reading quantities, so two bills cannot both claim one receipt and a receipt cannot be reversed
 * from under a bill. It never touches the bill's journal. A bill with no order lines, in a company that does not require
 * them, leaves here untouched.
 */
final class BillMatchGate
{
    public function __construct(
        private readonly BillMatchEvaluator $evaluator,
        private readonly PermissionChecker $permissions,
        private readonly IdGenerator $ids,
        private readonly Clock $clock,
    ) {}

    public function enforce(Actor $actor, LockSet $locks, AuditBuffer $audit, Outbox $outbox, Invoice $bill, ?string $overrideReason): void
    {
        $orderLineIds = array_values(array_filter($bill->lines->pluck('purchase_order_line_id')->all()));
        if ($orderLineIds !== []) {
            $orderIds = array_values(array_unique(PurchaseOrderLine::query()->whereIn('id', $orderLineIds)->pluck('purchase_order_id')->all()));
            foreach (PurchaseOrder::query()->whereIn('id', $orderIds)->orderBy('id')->get() as $order) {
                $locks->document($order);
            }
        }

        $found = $this->evaluator->evaluate($bill);
        if (! $found->applies) {
            return;
        }
        if ($found->refusals !== []) {
            throw $this->refused([...$found->refusals, ...$found->mismatches]);
        }
        if ($found->mismatches === []) {
            $this->record($actor, $bill, 'matched', [], null);

            return;
        }

        $reason = trim((string) $overrideReason);
        if ($reason === '') {
            throw $this->refused($found->mismatches);
        }
        if ($actor->type !== ActorType::User || ! $this->permissions->allows($actor, 'bills.match_override', $bill->company_id)) {
            throw DomainRuleViolation::single('match_override_forbidden', 'You cannot override a purchase order mismatch.');
        }

        // Maker and checker differ: whoever created or submitted the bill may not wave its mismatch through.
        if (in_array($actor->id, [$bill->created_by, $bill->submitted_by], true)) {
            throw DomainRuleViolation::single('match_override_self_forbidden', 'You made this bill, so someone else has to override its purchase order mismatch.');
        }

        $violations = array_map(fn (Violation $v) => $v->toArray(), $found->mismatches);
        $this->record($actor, $bill, 'overridden', $violations, $reason);
        $audit->add('bill.match_overridden', $bill, after: $bill, context: ['reason' => $reason, 'violations' => $violations]);
        $outbox->add(new ProcurementEvent('bill.match_overridden', $bill->id, $bill->company_id, $bill->lock_version, ['reason' => $reason, 'codes' => array_column($violations, 'code')]));
    }

    /** @param non-empty-list<Violation> $violations */
    private function refused(array $violations): DomainRuleViolation
    {
        return new DomainRuleViolation($violations[0]->code, count($violations) === 1 ? $violations[0]->message : 'This bill does not match its purchase order.', $violations);
    }

    /** @param list<array<string, mixed>> $violations */
    private function record(Actor $actor, Invoice $bill, string $outcome, array $violations, ?string $reason): void
    {
        (new BillMatchResult)->forceFill([
            'id' => $this->ids->next(), 'tenant_id' => $actor->tenantId, 'company_id' => $bill->company_id, 'invoice_id' => $bill->id,
            'outcome' => $outcome, 'violations' => $violations, 'reason' => $reason, 'decided_by' => $actor->id, 'created_at' => $this->clock->now(),
        ])->save();
    }
}
