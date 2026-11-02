<?php

declare(strict_types=1);

namespace App\Actions\Banking;

use App\Actions\Ledger\SetupGuard;
use App\Contracts\Clock;
use App\Domain\Shared\DomainRuleViolation;
use App\Models\Banking\BankAccount;
use App\Models\Banking\BankStatementLine;
use App\Services\Banking\BankLineState;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;

/**
 * Leaves a statement line out of the books with a reason, such as a bank error it later corrected, or puts it back. The
 * line stays on the statement, so it stays in the reconciliation's arithmetic and is listed there as excluded.
 */
final class ExcludeStatementLine
{
    public function __construct(
        private readonly UnitOfWork $uow,
        private readonly SetupGuard $guard,
        private readonly BankLineState $state,
        private readonly Clock $clock,
    ) {}

    public function exclude(Actor $actor, string $companyId, string $lineId, string $reason, int $version): BankStatementLine
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $companyId, $lineId, $reason, $version) {
            $line = $this->locked($locks, $actor, $companyId, $lineId, $version);
            if ($line->status !== 'unmatched') {
                throw DomainRuleViolation::single('bank_line_not_open', 'Only an unmatched line can be excluded.');
            }
            $this->state->assertOpenForMatching($line);

            $before = $line->attributesToArray();
            $line->forceFill([
                'status' => 'excluded', 'excluded_reason' => $reason, 'excluded_by' => $actor->id,
                'excluded_at' => $this->clock->now(), 'lock_version' => $line->lock_version + 1,
            ])->save();
            $audit->add('bank_line.excluded', $line, before: $before, after: $line, context: ['reason' => $reason]);

            return $line;
        });
    }

    public function restore(Actor $actor, string $companyId, string $lineId, int $version): BankStatementLine
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $companyId, $lineId, $version) {
            $line = $this->locked($locks, $actor, $companyId, $lineId, $version);
            if ($line->status !== 'excluded') {
                throw DomainRuleViolation::single('bank_line_not_excluded', 'This line is not excluded.');
            }
            $this->state->assertNotReconciled($line);

            $before = $line->attributesToArray();
            $line->forceFill([
                'status' => 'unmatched', 'excluded_reason' => null, 'excluded_by' => null,
                'excluded_at' => null, 'lock_version' => $line->lock_version + 1,
            ])->save();
            $audit->add('bank_line.restored', $line, before: $before, after: $line);

            return $line;
        });
    }

    private function locked(LockSet $locks, Actor $actor, string $companyId, string $lineId, int $version): BankStatementLine
    {
        $this->guard->require($actor, 'banking.reconcile', $companyId);
        $seen = BankStatementLine::query()->where('company_id', $companyId)->findOrFail($lineId);
        $locks->document(BankAccount::query()->findOrFail($seen->bank_account_id));

        return $locks->document($seen, $version);
    }
}
