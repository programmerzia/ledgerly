<?php

declare(strict_types=1);

namespace App\Services\Banking;

use App\Contracts\Clock;
use App\Contracts\IdGenerator;
use App\Domain\Shared\DomainRuleViolation;
use App\Models\Banking\BankAccount;
use App\Models\Banking\BankMatch;
use App\Models\Banking\BankStatementLine;
use App\Models\Ledger\JournalLine;
use App\Support\Actor;
use Illuminate\Database\DatabaseManager;

/** What the matching Actions share: is a line open, and writing or removing a match (the caller holds the locks). */
final class BankLineState
{
    public function __construct(private readonly DatabaseManager $db, private readonly IdGenerator $ids, private readonly Clock $clock) {}

    /** A line of a finished reconciliation, or one waiting for approval, cannot be matched by hand. */
    public function assertOpenForMatching(BankStatementLine $line): void
    {
        $this->assertNotReconciled($line);
        if ($this->pendingJournalId($line->id) !== null) {
            throw DomainRuleViolation::single('bank_line_pending_approval', 'This line is waiting for the approval of its bank transaction.');
        }
    }

    public function assertNotReconciled(BankStatementLine $line): void
    {
        $finished = $this->db->connection()->table('bank_reconciliations')->where('statement_id', $line->statement_id)->where('status', 'finished')->exists();
        if ($finished) {
            throw DomainRuleViolation::single('reconciliation_finished', 'The statement of this line has a finished reconciliation; reopen it first.');
        }
    }

    public function pendingJournalId(string $lineId): ?string
    {
        $id = $this->db->connection()->table('bank_transactions as t')->join('journals as j', 'j.id', '=', 't.journal_id')
            ->where('t.statement_line_id', $lineId)->where('j.status', 'pending_approval')->value('j.id');

        return is_string($id) ? $id : null;
    }

    /** @param list<string> $journalLineIds */
    public function bookLinesMatched(array $journalLineIds): bool
    {
        return $this->db->connection()->table('bank_match_items')->whereIn('journal_line_id', $journalLineIds)->exists();
    }

    /**
     * @param  list<BankStatementLine>  $lines
     * @param  list<JournalLine>  $bookLines
     * @param  array<string, string>  $settlementOfLine
     */
    public function createMatch(Actor $actor, BankAccount $account, array $lines, array $bookLines, int $amount, array $settlementOfLine, ?string $by): BankMatch
    {
        $now = $this->clock->now();
        $stamp = $now->format('Y-m-d H:i:s.uP');
        $match = new BankMatch;
        $match->forceFill([
            'id' => $this->ids->next(), 'tenant_id' => $actor->tenantId, 'company_id' => $account->company_id, 'bank_account_id' => $account->id,
            'amount' => $amount, 'matched_by' => $by, 'matched_at' => $now,
        ])->save();
        $items = [];
        $base = ['tenant_id' => $actor->tenantId, 'company_id' => $account->company_id, 'match_id' => $match->id, 'created_at' => $stamp, 'updated_at' => $stamp];
        foreach ($lines as $l) {
            $items[] = [...$base, 'id' => $this->ids->next(), 'statement_line_id' => $l->id, 'journal_line_id' => null, 'settlement_id' => null, 'amount' => $l->amount];
        }
        foreach ($bookLines as $b) {
            $items[] = [...$base, 'id' => $this->ids->next(), 'statement_line_id' => null, 'journal_line_id' => $b->id, 'settlement_id' => $settlementOfLine[$b->id] ?? null, 'amount' => $b->amount_fc];
        }
        $conn = $this->db->connection();
        $conn->table('bank_match_items')->insert($items);
        $conn->table('bank_statement_lines')->whereIn('id', array_map(fn (BankStatementLine $l): string => $l->id, $lines))
            ->update(['status' => 'matched', 'lock_version' => $conn->raw('lock_version + 1'), 'updated_at' => $stamp]);

        return $match;
    }

    /** Removes a match and frees its statement lines. */
    public function removeMatch(BankMatch $match): void
    {
        $conn = $this->db->connection();
        $lineIds = $conn->table('bank_match_items')->where('match_id', $match->id)->whereNotNull('statement_line_id')->pluck('statement_line_id')->all();
        $conn->table('bank_match_items')->where('match_id', $match->id)->delete();
        $conn->table('bank_matches')->where('id', $match->id)->delete();
        $conn->table('bank_statement_lines')->whereIn('id', $lineIds)->update(['status' => 'unmatched', 'lock_version' => $conn->raw('lock_version + 1'), 'updated_at' => $this->clock->now()->format('Y-m-d H:i:s.uP')]);
    }
}
