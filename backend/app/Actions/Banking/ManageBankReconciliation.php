<?php

declare(strict_types=1);

namespace App\Actions\Banking;

use App\Actions\Ledger\SetupGuard;
use App\Contracts\Clock;
use App\Contracts\IdGenerator;
use App\Domain\Shared\DomainRuleViolation;
use App\Events\Banking\BankReconciliationFinished;
use App\Events\Banking\BankReconciliationReopened;
use App\Models\Banking\BankAccount;
use App\Models\Banking\BankReconciliation;
use App\Models\Banking\BankStatement;
use App\Services\Banking\ReconciliationCalculator;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;
use Illuminate\Database\DatabaseManager;

/**
 * Start, finish and reopen a bank reconciliation (one per statement). Finishing needs a zero difference (statement closing balance =
 * book balance adjusted for unmatched items, see ReconciliationCalculator); it freezes the matches it covers and the report. Reopening
 * (`banking.reconcile`, a reason, audited) is the only way back. ADR-0004 does not list reconciliation among the signed actions, so
 * neither finish nor reopen needs a signing PIN (the mock asks only for a confirmation); both are people only, as is every banking write
 * but statement import. Lock order: bank account (40), then the reconciliation (42).
 */
final class ManageBankReconciliation
{
    public function __construct(
        private readonly UnitOfWork $uow,
        private readonly SetupGuard $guard,
        private readonly IdGenerator $ids,
        private readonly Clock $clock,
        private readonly ReconciliationCalculator $calculator,
        private readonly DatabaseManager $db,
    ) {}

    public function start(Actor $actor, string $companyId, string $statementId): BankReconciliation
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $companyId, $statementId) {
            $this->guard->require($actor, 'banking.reconcile', $companyId);
            $statement = BankStatement::query()->where('company_id', $companyId)->find($statementId) ?? throw DomainRuleViolation::single('not_found', 'The statement does not exist.');
            $locks->document(BankAccount::query()->findOrFail($statement->bank_account_id));
            if (BankReconciliation::query()->where('statement_id', $statement->id)->exists()) {
                throw DomainRuleViolation::single('reconciliation_exists', 'This statement already has a reconciliation.');
            }
            $r = new BankReconciliation;
            $r->forceFill([
                'id' => $this->ids->next(), 'tenant_id' => $actor->tenantId, 'company_id' => $companyId, 'bank_account_id' => $statement->bank_account_id,
                'statement_id' => $statement->id, 'as_of' => $statement->period_to, 'status' => 'in_progress', 'started_by' => $actor->id, 'lock_version' => 0,
            ])->save();
            $audit->add('bank_reconciliation.started', $r, after: $r);

            return $r;
        });
    }

    public function finish(Actor $actor, string $companyId, string $id, ?int $lockVersion): BankReconciliation
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $companyId, $id, $lockVersion) {
            $this->guard->require($actor, 'banking.reconcile', $companyId);
            $seen = BankReconciliation::query()->where('company_id', $companyId)->find($id) ?? throw DomainRuleViolation::single('not_found', 'The reconciliation does not exist.');
            $account = $locks->document(BankAccount::query()->findOrFail($seen->bank_account_id));
            $r = $locks->document($seen, $lockVersion);
            if ($r->status !== 'in_progress') {
                throw DomainRuleViolation::single('reconciliation_finished', 'This reconciliation is already finished.');
            }
            $statement = BankStatement::query()->findOrFail($r->statement_id);
            if ($statement->closing_balance === null) {
                throw DomainRuleViolation::single('statement_balance_missing', 'The statement has no closing balance; import it again with one.');
            }
            $report = $this->calculator->compute($account, $statement);
            if ($report['difference'] !== 0) {
                throw DomainRuleViolation::single('reconciliation_difference', "The statement and the books differ by {$report['difference']} (minor units); resolve it before finishing.");
            }

            $now = $this->clock->now();
            $before = $r->attributesToArray();
            $r->forceFill([
                'status' => 'finished', 'book_balance' => $report['book']['balance'], 'statement_balance' => $statement->closing_balance, 'difference' => 0,
                'report' => $report, 'finished_by' => $actor->id, 'finished_at' => $now, 'lock_version' => $r->lock_version + 1,
            ])->save();
            $this->db->connection()->update(
                'UPDATE bank_matches SET reconciliation_id = :r WHERE bank_account_id = :a AND reconciliation_id IS NULL AND NOT EXISTS ('
                .'SELECT 1 FROM bank_match_items i JOIN bank_statement_lines sl ON sl.id = i.statement_line_id JOIN bank_statements st ON st.id = sl.statement_id '
                .'WHERE i.match_id = bank_matches.id AND st.period_to > :to)',
                ['r' => $r->id, 'a' => $account->id, 'to' => $statement->period_to->format('Y-m-d')],
            );
            $audit->add('bank_reconciliation.finished', $r, before: $before, after: $r);
            $outbox->add(new BankReconciliationFinished($r->id, $companyId, $r->lock_version, ['bank_account_id' => $account->id]));

            return $r;
        });
    }

    public function reopen(Actor $actor, string $companyId, string $id, string $reason, ?int $lockVersion): BankReconciliation
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $companyId, $id, $reason, $lockVersion) {
            $this->guard->require($actor, 'banking.reconcile', $companyId);
            if (trim($reason) === '') {
                throw DomainRuleViolation::single('reason_required', 'Say why the reconciliation is reopened.');
            }
            $seen = BankReconciliation::query()->where('company_id', $companyId)->find($id) ?? throw DomainRuleViolation::single('not_found', 'The reconciliation does not exist.');
            $account = $locks->document(BankAccount::query()->findOrFail($seen->bank_account_id));
            $r = $locks->document($seen, $lockVersion);
            if ($r->status !== 'finished') {
                throw DomainRuleViolation::single('reconciliation_not_finished', 'Only a finished reconciliation can be reopened.');
            }
            $statement = BankStatement::query()->findOrFail($r->statement_id);
            $later = BankReconciliation::query()->where('bank_account_id', $account->id)->where('status', 'finished')
                ->whereIn('statement_id', BankStatement::query()->where('bank_account_id', $account->id)->where('period_to', '>', $statement->period_to->format('Y-m-d'))->select('id'))->exists();
            if ($later) {
                throw DomainRuleViolation::single('later_reconciliation_finished', 'A later statement is already reconciled; reopen that one first.');
            }

            $before = $r->attributesToArray();
            $this->db->connection()->table('bank_matches')->where('reconciliation_id', $r->id)->update(['reconciliation_id' => null]);
            $r->forceFill([
                'status' => 'in_progress', 'book_balance' => null, 'statement_balance' => null, 'difference' => null, 'report' => null, 'finished_by' => null, 'finished_at' => null,
                'reopened_by' => $actor->id, 'reopened_at' => $this->clock->now(), 'reopen_reason' => trim($reason), 'reopen_count' => $r->reopen_count + 1,
                'lock_version' => $r->lock_version + 1,
            ])->save();
            $audit->add('bank_reconciliation.reopened', $r, before: $before, after: $r, context: ['reason' => trim($reason)]);
            $outbox->add(new BankReconciliationReopened($r->id, $companyId, $r->lock_version, ['bank_account_id' => $account->id]));

            return $r;
        });
    }
}
