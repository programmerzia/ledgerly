<?php

declare(strict_types=1);

namespace App\Services\Banking;

use App\Models\Banking\BankAccount;
use App\Models\Banking\BankStatement;
use Illuminate\Database\DatabaseManager;

/**
 * The arithmetic of a bank reconciliation (statement closing balance = book balance adjusted for unmatched items), in the
 * bank account's currency, signed with money in positive (a debit to the bank GL account).
 *
 * Statement side (L): every line of the account's statements up to and including this one (period_to). Book side: lines of
 * posted or reversed journals on the bank GL account in the account's currency, dated on or before `as_of`.
 * A match counts for this reconciliation only when ALL its statement lines are in L ("covered"); any other match is
 * treated as unmatched on both sides here.
 *   book_balance B   = opening_position + matched_book + unmatched_book         (exact decomposition, no rounding)
 *   adjusted_book    = B - unmatched_book + unmatched_statement + matched_after_as_of
 *   difference       = statement closing balance - adjusted_book
 * opening_position is the lines of journals of type `opening` (the migration/opening balance) that are not matched; they stand
 * for the statement's opening balance. matched_after_as_of is the book side of matches whose book line is dated after the
 * statement date (booked late, already on the statement): in the statement, not yet in B.
 * Zero difference therefore proves: the statement agrees with itself and with the opening balance, and every match is exact.
 */
final class ReconciliationCalculator
{
    private const int LIST_CAP = 100;

    public function __construct(private readonly DatabaseManager $db) {}

    /** @return array<string, mixed> */
    public function compute(BankAccount $account, BankStatement $statement): array
    {
        $c = $this->db->connection();
        $asOf = $statement->period_to->format('Y-m-d');
        $closing = $statement->closing_balance;

        $covered = 'SELECT m.id FROM bank_matches m WHERE m.bank_account_id = :a AND NOT EXISTS ('
            .'SELECT 1 FROM bank_match_items i JOIN bank_statement_lines sl ON sl.id = i.statement_line_id JOIN bank_statements st ON st.id = sl.statement_id '
            .'WHERE i.match_id = m.id AND st.period_to > :to)';
        $bind = ['a' => $account->id, 'to' => $asOf];

        // Statement side.
        $stmt = $c->selectOne(
            "SELECT coalesce(sum(sl.amount) FILTER (WHERE cm.id IS NULL), 0) AS unmatched, count(*) FILTER (WHERE cm.id IS NULL) AS unmatched_count,
                    coalesce(sum(sl.amount) FILTER (WHERE cm.id IS NOT NULL), 0) AS matched
             FROM bank_statement_lines sl JOIN bank_statements st ON st.id = sl.statement_id
             LEFT JOIN (SELECT i.statement_line_id, m.id FROM bank_match_items i JOIN bank_matches m ON m.id = i.match_id WHERE m.id IN ({$covered})) cm ON cm.statement_line_id = sl.id
             WHERE sl.bank_account_id = :a AND st.period_to <= :to",
            $bind,
        );

        // Book side.
        $book = $c->selectOne(
            "SELECT
                coalesce(sum(jl.amount_fc) FILTER (WHERE cm.id IS NOT NULL AND j.journal_date <= :to2), 0) AS matched,
                coalesce(sum(jl.amount_fc) FILTER (WHERE cm.id IS NOT NULL AND j.journal_date > :to3), 0) AS late,
                coalesce(sum(jl.amount_fc) FILTER (WHERE cm.id IS NULL AND j.journal_type = 'opening' AND j.journal_date <= :to4), 0) AS opening,
                coalesce(sum(jl.amount_fc) FILTER (WHERE cm.id IS NULL AND j.journal_type <> 'opening' AND j.journal_date <= :to5), 0) AS unmatched,
                count(*) FILTER (WHERE cm.id IS NULL AND j.journal_type <> 'opening' AND j.journal_date <= :to6) AS unmatched_count
             FROM journal_lines jl JOIN journals j ON j.id = jl.journal_id
             LEFT JOIN (SELECT i.journal_line_id, m.id FROM bank_match_items i JOIN bank_matches m ON m.id = i.match_id WHERE m.id IN ({$covered})) cm ON cm.journal_line_id = jl.id
             WHERE jl.company_id = :company AND jl.account_id = :gl AND jl.currency = :cur AND j.status IN ('posted', 'reversed')",
            ['a' => $account->id, 'to' => $asOf, 'to2' => $asOf, 'to3' => $asOf, 'to4' => $asOf, 'to5' => $asOf, 'to6' => $asOf, 'company' => $account->company_id, 'gl' => $account->account_id, 'cur' => $account->currency],
        );

        $matchedBook = (int) $book->matched;
        $openingPosition = (int) $book->opening;
        $unmatchedBook = (int) $book->unmatched;
        $late = (int) $book->late;
        $bookBalance = $openingPosition + $matchedBook + $unmatchedBook;
        $unmatchedStatement = (int) $stmt->unmatched;
        $adjusted = $bookBalance - $unmatchedBook + $unmatchedStatement + $late;
        $difference = $closing === null ? null : $closing - $adjusted;

        $flow = $c->selectOne(
            'SELECT coalesce(sum(amount) FILTER (WHERE amount > 0), 0) AS receipts, coalesce(sum(amount) FILTER (WHERE amount < 0), 0) AS payments, count(*) AS n FROM bank_statement_lines WHERE statement_id = :s',
            ['s' => $statement->id],
        );

        return [
            'as_of' => $asOf,
            'currency' => $account->currency,
            'statement' => [
                'opening_balance' => $statement->opening_balance, 'receipts' => (int) $flow->receipts, 'payments' => (int) $flow->payments,
                'closing_balance' => $closing, 'line_count' => (int) $flow->n,
            ],
            'book' => [
                'balance' => $bookBalance, 'opening_position' => $openingPosition, 'matched' => $matchedBook, 'unmatched' => $unmatchedBook,
                'unmatched_count' => (int) $book->unmatched_count, 'matched_after_as_of' => $late,
            ],
            'unmatched_statement' => ['total' => $unmatchedStatement, 'count' => (int) $stmt->unmatched_count],
            'adjusted_book_balance' => $adjusted,
            'difference' => $difference,
            'unmatched_book_items' => $this->unmatchedBook($account, $asOf, $covered, $bind),
            'unmatched_statement_items' => $this->unmatchedStatement($account, $asOf, $covered, $bind),
        ];
    }

    /**
     * @param  array<string, string>  $bind
     * @return list<array<string, mixed>>
     */
    private function unmatchedBook(BankAccount $account, string $asOf, string $covered, array $bind): array
    {
        $rows = $this->db->connection()->select(
            "SELECT jl.id AS journal_line_id, j.id AS journal_id, j.number, j.journal_date, jl.amount_fc AS amount, coalesce(jl.description, j.memo, '') AS description
             FROM journal_lines jl JOIN journals j ON j.id = jl.journal_id
             WHERE jl.company_id = :company AND jl.account_id = :gl AND jl.currency = :cur AND j.status IN ('posted', 'reversed')
               AND j.journal_type <> 'opening' AND j.journal_date <= :to
               AND NOT EXISTS (SELECT 1 FROM bank_match_items i WHERE i.journal_line_id = jl.id AND i.match_id IN ({$covered}))
             ORDER BY j.journal_date, jl.id LIMIT ".self::LIST_CAP,
            ['company' => $account->company_id, 'gl' => $account->account_id, 'cur' => $account->currency, 'to' => $asOf, ...$bind],
        );

        return array_values(array_map(function (object $o): array {
            $r = (array) $o;

            return ['journal_line_id' => $r['journal_line_id'], 'journal_id' => $r['journal_id'], 'number' => $r['number'], 'date' => $r['journal_date'], 'amount' => (int) $r['amount'], 'description' => $r['description']];
        }, $rows));
    }

    /**
     * @param  array<string, string>  $bind
     * @return list<array<string, mixed>>
     */
    private function unmatchedStatement(BankAccount $account, string $asOf, string $covered, array $bind): array
    {
        $rows = $this->db->connection()->select(
            "SELECT sl.id, sl.txn_date, sl.amount, sl.description, sl.status FROM bank_statement_lines sl JOIN bank_statements st ON st.id = sl.statement_id
             WHERE sl.bank_account_id = :a AND st.period_to <= :to
               AND NOT EXISTS (SELECT 1 FROM bank_match_items i WHERE i.statement_line_id = sl.id AND i.match_id IN ({$covered}))
             ORDER BY sl.txn_date, sl.id LIMIT ".self::LIST_CAP,
            $bind,
        );

        return array_values(array_map(function (object $o): array {
            $r = (array) $o;

            return ['statement_line_id' => $r['id'], 'date' => $r['txn_date'], 'amount' => (int) $r['amount'], 'description' => $r['description'], 'status' => $r['status']];
        }, $rows));
    }
}
