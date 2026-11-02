<?php

declare(strict_types=1);

namespace App\Services\Banking;

use App\Domain\Banking\MatchBalance;
use App\Domain\Shared\DomainRuleViolation;
use App\Models\Banking\BankAccount;
use App\Models\Banking\BankStatementLine;
use App\Models\Banking\BankTransaction;
use App\Models\Ledger\Journal;
use App\Models\Ledger\JournalLine;
use App\Support\Actor;
use App\Support\UnitOfWork\LockSet;
use Illuminate\Database\DatabaseManager;

/**
 * The two places the ledger Actions call into banking, both inside their unit of work and after the journal is locked (13 §8: journal
 * rank 10, then bank account 40, then statement line 45, all before sequences):
 *  - posting a journal that belongs to a bank transaction matches its statement line (direct post and approval alike);
 *  - reversing a journal matched in a finished reconciliation is refused (`journal_in_finished_reconciliation`).
 */
final class BankLedgerHooks
{
    public function __construct(private readonly BankLineState $state, private readonly DatabaseManager $db) {}

    public function beforePost(Actor $actor, LockSet $locks, Journal $journal): void
    {
        if ($journal->source_type !== 'bank_transaction' || $journal->source_id === null) {
            return;
        }
        $txn = BankTransaction::query()->where('company_id', $journal->company_id)->find($journal->source_id);
        if ($txn === null) {
            return;
        }
        $account = $locks->document(BankAccount::query()->whereKey($txn->bank_account_id)->firstOrFail());
        $line = $locks->document(BankStatementLine::query()->whereKey($txn->statement_line_id)->firstOrFail());
        if ($line->status !== 'unmatched') {
            throw DomainRuleViolation::single('bank_line_already_matched', 'The bank line was matched to something else in the meantime; void this transaction.');
        }
        $this->state->assertNotReconciled($line);
        $book = array_values(JournalLine::query()->where('journal_id', $journal->id)->where('account_id', $account->account_id)->get()->all());
        $amount = MatchBalance::assertEqual([$line->amount], array_map(fn (JournalLine $b): int => $b->amount_fc, $book));
        $this->state->createMatch($actor, $account, [$line], $book, $amount, [], $actor->id);
    }

    public function beforeReverse(LockSet $locks, Journal $journal): void
    {
        $conn = $this->db->connection();
        $matches = $conn->table('bank_match_items as i')->join('bank_matches as m', 'm.id', '=', 'i.match_id')
            ->join('journal_lines as jl', 'jl.id', '=', 'i.journal_line_id')->where('jl.journal_id', $journal->id)
            ->select('m.id', 'm.bank_account_id')->get();
        if ($matches->isEmpty()) {
            return;
        }
        foreach ($matches->pluck('bank_account_id')->unique()->sort()->values() as $accountId) {
            $locks->document(BankAccount::query()->whereKey($accountId)->firstOrFail());
        }
        $covered = $conn->table('bank_matches')->whereIn('id', $matches->pluck('id')->all())->whereNotNull('reconciliation_id')->exists();
        if ($covered) {
            throw DomainRuleViolation::single('journal_in_finished_reconciliation', 'This journal is matched in a finished bank reconciliation; reopen the reconciliation before reversing it.');
        }
    }
}
