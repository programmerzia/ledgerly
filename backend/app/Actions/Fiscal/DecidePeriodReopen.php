<?php

declare(strict_types=1);

namespace App\Actions\Fiscal;

use App\Contracts\Clock;
use App\Domain\Fiscal\PeriodStatus;
use App\Domain\Fiscal\ReopenRequestStatus;
use App\Domain\Shared\DomainRuleViolation;
use App\Domain\Signing\Signature;
use App\Events\Fiscal\PeriodReopened;
use App\Models\Fiscal\FiscalPeriod;
use App\Models\Fiscal\PeriodReopenRequest;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;
use DateTimeZone;

/**
 * Approves or rejects a reopen request (13 §10). Two distinct approvers, neither the requester,
 * each with a signing grant; the second approval reopens the period. A rejection by any approver
 * ends the request. The database CHECKs enforce the same distinctness.
 */
final class DecidePeriodReopen
{
    public function __construct(private readonly UnitOfWork $uow, private readonly FiscalGuard $guard, private readonly Clock $clock) {}

    public function approve(Actor $actor, string $requestId): PeriodReopenRequest
    {
        return $this->decide($actor, $requestId, true, null);
    }

    public function reject(Actor $actor, string $requestId, string $comment): PeriodReopenRequest
    {
        if (trim($comment) === '') {
            throw DomainRuleViolation::single('comment_required', 'Say why the reopen is rejected.');
        }

        return $this->decide($actor, $requestId, false, trim($comment));
    }

    private function decide(Actor $actor, string $requestId, bool $approve, ?string $comment): PeriodReopenRequest
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $requestId, $approve, $comment) {
            $unlocked = PeriodReopenRequest::query()->find($requestId);
            if ($unlocked === null) {
                throw DomainRuleViolation::single('not_found', 'The reopen request does not exist.');
            }
            $period = $this->guard->lockPeriod($locks, $unlocked->fiscal_period_id);
            $this->guard->require($actor, 'periods.reopen.approve', $period->company_id, signed: $approve);
            $request = PeriodReopenRequest::query()->whereKey($requestId)->lockForUpdate()->firstOrFail();

            if ($request->status !== ReopenRequestStatus::Pending) {
                throw DomainRuleViolation::single('reopen_not_pending', 'The request has already been decided.');
            }
            if ($actor->id === $request->requested_by) {
                throw DomainRuleViolation::single('self_approval_forbidden', 'You asked for this reopen, so two other people have to approve it.');
            }
            if ($actor->id === $request->first_approver) {
                throw DomainRuleViolation::single('approver_already_signed', 'You already approved; a second, different approver is needed.');
            }
            if ($period->status !== PeriodStatus::Closed) {
                throw DomainRuleViolation::single('period_not_closed', 'The period is no longer closed.');
            }

            $now = $this->clock->now();
            $before = $request->attributesToArray();
            if (! $approve) {
                $request->forceFill(['status' => ReopenRequestStatus::Rejected, 'decided_at' => $now, 'decision_comment' => $comment])->save();
                $audit->add('period.reopen_rejected', $request, before: $before, after: $request);

                return $request;
            }

            $signature = Signature::hash(
                $request->id, Signature::contentHash(['period_id' => $period->id, 'reason' => $request->reason, 'requested_by' => $request->requested_by]),
                PeriodStatus::Open->value, (string) $actor->id, $now->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d\TH:i:s.u\Z'),
            );
            $first = $request->first_approver === null;
            $request->forceFill($first
                ? ['first_approver' => $actor->id, 'first_signed_at' => $now]
                : ['second_approver' => $actor->id, 'second_signed_at' => $now, 'status' => ReopenRequestStatus::Approved, 'decided_at' => $now])->save();
            $audit->add('period.reopen_approved', $request, before: $before, after: $request, context: ['slot' => $first ? 1 : 2, 'signature_hash' => $signature]);

            if (! $first) {
                $this->reopen($period, $audit);
                $outbox->add(new PeriodReopened($period->company_id, $period->id, ['request_id' => $request->id]));
            }

            return $request;
        });
    }

    private function reopen(FiscalPeriod $period, AuditBuffer $audit): void
    {
        $before = $period->attributesToArray();
        $period->forceFill([
            'status' => PeriodStatus::Open, 'closed_at' => null, 'closed_by' => null, 'soft_closed_at' => null,
            'reopened_count' => $period->reopened_count + 1,
        ])->save();
        $audit->add('period.reopened', $period, before: $before, after: $period);
    }
}
