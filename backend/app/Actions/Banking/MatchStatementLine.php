<?php

declare(strict_types=1);

namespace App\Actions\Banking;

use App\Actions\Banking\Inputs\MatchInput;
use App\Actions\Ledger\SetupGuard;
use App\Domain\Banking\MatchBalance;
use App\Domain\Ledger\JournalStatus;
use App\Domain\Shared\DomainRuleViolation;
use App\Events\Banking\BankMatchCreated;
use App\Models\Banking\BankAccount;
use App\Models\Banking\BankMatch;
use App\Models\Banking\BankStatementLine;
use App\Models\Ledger\Journal;
use App\Models\Ledger\JournalLine;
use App\Models\Trade\Settlement;
use App\Services\Banking\BankLineState;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;
use Illuminate\Database\UniqueConstraintViolationException;

/**
 * Matches statement lines to posted book lines on the bank's GL account, or to settlements (their bank line). One-to-one, many-to-one
 * and one-to-many are allowed only when both sides add up to exactly the same amount. A line sits in one match at most (unique index
 * on each side); lines of a finished reconciliation cannot be matched. Lock order (13 §8): journals, bank account, statement lines.
 */
final class MatchStatementLine
{
    public function __construct(
        private readonly UnitOfWork $uow,
        private readonly SetupGuard $guard,
        private readonly BankLineState $state,
    ) {}

    public function handle(Actor $actor, MatchInput $in): BankMatch
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $in) {
            $this->guard->require($actor, 'banking.reconcile', $in->companyId);

            $stmtIds = array_values(array_unique($in->statementLineIds));
            $seenLines = BankStatementLine::query()->where('company_id', $in->companyId)->whereIn('id', $stmtIds)->get();
            if ($seenLines->count() !== count($stmtIds) || $stmtIds === []) {
                throw DomainRuleViolation::single('not_found', 'A statement line does not exist.');
            }
            $accountId = $seenLines->first()?->bank_account_id;
            if ($seenLines->contains(fn (BankStatementLine $l): bool => $l->bank_account_id !== $accountId)) {
                throw DomainRuleViolation::single('match_accounts_differ', 'All statement lines of a match belong to one bank account.');
            }
            $account = BankAccount::query()->findOrFail($accountId);

            $bookIds = $this->bookLineIds($in, $account);
            if ($bookIds === []) {
                throw DomainRuleViolation::single('match_empty', 'A match needs at least one statement line and one book line.');
            }
            $bookLines = JournalLine::query()->where('company_id', $in->companyId)->whereIn('id', $bookIds)->get();
            if ($bookLines->count() !== count($bookIds)) {
                throw DomainRuleViolation::single('not_found', 'A book line does not exist.');
            }

            // 2: journals (rank 10) by id, then the bank account (40), then the statement lines (45) by id.
            $journalIds = $bookLines->pluck('journal_id')->unique()->sort()->values()->all();
            $journals = [];
            foreach ($journalIds as $jid) {
                $journals[$jid] = $locks->document(Journal::query()->whereKey($jid)->firstOrFail());
            }
            $locks->document($account);
            $lines = [];
            foreach (collect($stmtIds)->sort()->values() as $id) {
                $lines[] = $locks->document(BankStatementLine::query()->whereKey($id)->firstOrFail());
            }

            foreach ($bookLines as $bl) {
                $j = $journals[$bl->journal_id];
                if ($bl->account_id !== $account->account_id || $bl->currency !== $account->currency) {
                    throw DomainRuleViolation::single('book_line_not_on_account', 'A book line is not on this bank account\'s GL account and currency.');
                }
                if ($j->status !== JournalStatus::Posted || $j->reversal_of_id !== null) {
                    throw DomainRuleViolation::single('book_line_not_matchable', 'Only lines of posted, unreversed journals can be matched.');
                }
            }
            foreach ($lines as $l) {
                if ($l->status !== 'unmatched') {
                    throw DomainRuleViolation::single('line_already_matched', 'A statement line is already matched or excluded.');
                }
                $this->state->assertOpenForMatching($l);
            }
            if ($this->state->bookLinesMatched($bookIds)) {
                throw DomainRuleViolation::single('book_line_already_matched', 'A book line is already matched.');
            }

            $bookList = array_values($bookLines->all());
            $amount = MatchBalance::assertEqual(array_map(fn (BankStatementLine $l): int => $l->amount, $lines), array_map(fn (JournalLine $b): int => $b->amount_fc, $bookList));

            try {
                $match = $this->state->createMatch($actor, $account, $lines, $bookList, $amount, $this->settlementOf($in), $actor->id);
            } catch (UniqueConstraintViolationException) {
                throw DomainRuleViolation::single('line_already_matched', 'A line is already matched.');
            }
            $audit->add('bank_match.created', $match, after: $match, context: ['statement_lines' => $stmtIds, 'book_lines' => $bookIds, 'amount' => $amount]);
            $outbox->add(new BankMatchCreated($match->id, $account->company_id, 0, ['bank_account_id' => $account->id, 'amount' => $amount]));

            return $match;
        });
    }

    /** @return list<string> */
    private function bookLineIds(MatchInput $in, BankAccount $account): array
    {
        $ids = $in->journalLineIds;
        foreach (array_unique($in->settlementIds) as $sid) {
            $s = Settlement::query()->where('company_id', $in->companyId)->find($sid) ?? throw DomainRuleViolation::single('not_found', 'The settlement does not exist.');
            if ($s->journal_id === null) {
                throw DomainRuleViolation::single('settlement_not_posted', 'Only a posted settlement can be matched.');
            }
            $found = JournalLine::query()->where('journal_id', $s->journal_id)->where('account_id', $account->account_id)->pluck('id')->all();
            if ($found === []) {
                throw DomainRuleViolation::single('settlement_not_on_account', 'The settlement has no line on this bank account.');
            }
            array_push($ids, ...$found);
        }

        return array_values(array_unique($ids));
    }

    /** @return array<string, string> journal line id → settlement id, for the items */
    private function settlementOf(MatchInput $in): array
    {
        $map = [];
        foreach (array_unique($in->settlementIds) as $sid) {
            $jid = Settlement::query()->whereKey($sid)->value('journal_id');
            foreach (JournalLine::query()->where('journal_id', $jid)->pluck('id') as $lineId) {
                $map[(string) $lineId] = $sid;
            }
        }

        return $map;
    }
}
