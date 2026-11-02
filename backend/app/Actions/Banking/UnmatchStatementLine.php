<?php

declare(strict_types=1);

namespace App\Actions\Banking;

use App\Actions\Ledger\SetupGuard;
use App\Domain\Shared\DomainRuleViolation;
use App\Events\Banking\BankMatchRemoved;
use App\Models\Banking\BankAccount;
use App\Models\Banking\BankMatch;
use App\Models\Banking\BankStatementLine;
use App\Services\Banking\BankLineState;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;

/** Removes a match, until a finished reconciliation covers it (`reconciliation_finished`; reopen it first). */
final class UnmatchStatementLine
{
    public function __construct(private readonly UnitOfWork $uow, private readonly SetupGuard $guard, private readonly BankLineState $state) {}

    public function handle(Actor $actor, string $companyId, string $matchId): void
    {
        $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $companyId, $matchId) {
            $this->guard->require($actor, 'banking.reconcile', $companyId);
            $seen = BankMatch::query()->where('company_id', $companyId)->find($matchId) ?? throw DomainRuleViolation::single('not_found', 'The match does not exist.');
            $account = $locks->document(BankAccount::query()->whereKey($seen->bank_account_id)->firstOrFail());
            $lineIds = $seen->items()->whereNotNull('statement_line_id')->orderBy('statement_line_id')->pluck('statement_line_id')->all();
            foreach ($lineIds as $id) {
                $locks->document(BankStatementLine::query()->whereKey($id)->firstOrFail());
            }
            $match = BankMatch::query()->where('id', $matchId)->lockForUpdate()->first() ?? throw DomainRuleViolation::single('not_found', 'The match does not exist.');
            if ($match->reconciliation_id !== null) {
                throw DomainRuleViolation::single('reconciliation_finished', 'A finished reconciliation covers this match; reopen it first.');
            }
            $before = $match->attributesToArray();
            $this->state->removeMatch($match);
            $audit->add('bank_match.removed', $match, before: $before, context: ['statement_lines' => $lineIds]);
            $outbox->add(new BankMatchRemoved($match->id, $account->company_id, 0, ['bank_account_id' => $account->id]));
        });
    }
}
