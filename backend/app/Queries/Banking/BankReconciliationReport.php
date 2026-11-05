<?php

declare(strict_types=1);

namespace App\Queries\Banking;

use App\Http\Support\Json;
use App\Support\Reports\ReportRunner;
use Illuminate\Validation\ValidationException;

/**
 * The bank reconciliation report (3c.20) of one finished reconciliation, for a person to print or hand to an auditor.
 * Everything is read from what finishing froze (`bank_reconciliations.report`, written by ReconciliationCalculator),
 * so the report never differs from what was proved when the reconciliation was finished, even if the books move later.
 * Only the excluded lines (a list the snapshot holds as a count and a total) and the figures around the statement are
 * read live; the report says whether the live list still agrees with the frozen count.
 *
 *  - proof: statement closing balance against the adjusted book balance, step by step, with the checks a reader can
 *    repeat: opening + receipts + payments = closing; the steps add up to the adjusted balance; the difference is zero;
 *    the statement's opening balance equals the closing balance of the previous finished reconciliation of the account;
 *  - statement vs book: the frozen figures of both sides;
 *  - unmatched items on each side (the calculator keeps the first 100 of each; `truncated` says so) and the excluded lines.
 *
 * Amounts are signed in the bank account's currency, money in positive.
 */
final class BankReconciliationReport
{
    public function __construct(private readonly ReportRunner $runner) {}

    /** @return array<string, mixed> */
    public function __invoke(string $companyId, string $reconciliationId): array
    {
        $db = $this->runner->db();
        $r = $db->selectOne(
            'SELECT r.*, a.name AS account_name, a.bank_name, a.account_number_masked, a.currency AS account_currency, fu.name AS finished_by_name,
                    s.period_from, s.period_to, s.file_name, s.imported_at, s.opening_balance AS stmt_opening, s.closing_balance AS stmt_closing
             FROM bank_reconciliations r JOIN bank_accounts a ON a.id = r.bank_account_id JOIN bank_statements s ON s.id = r.statement_id
             LEFT JOIN users fu ON fu.id = r.finished_by WHERE r.company_id = ? AND r.id = ?',
            [$companyId, $reconciliationId],
        );
        if ($r === null) {
            throw ValidationException::withMessages(['reconciliation_id' => ['The reconciliation does not exist.']]);
        }
        $snapshot = json_decode((string) $r->report, true);
        if ($r->status !== 'finished' || ! is_array($snapshot)) {
            throw ValidationException::withMessages(['reconciliation_id' => ['This reconciliation is not finished. The report is made from a finished reconciliation.']]);
        }
        $cur = (string) $r->account_currency;
        $m = fn (int $v): array => Json::money($v, $cur);

        $statement = (array) $snapshot['statement'];
        $book = (array) $snapshot['book'];
        $unmatchedStatement = (array) $snapshot['unmatched_statement'];
        $excluded = (array) $snapshot['excluded_statement'];
        $late = (int) $book['matched_after_as_of'];
        $adjusted = (int) $snapshot['adjusted_book_balance'];
        $closing = (int) $statement['closing_balance'];
        $opening = $statement['opening_balance'] === null ? null : (int) $statement['opening_balance'];

        $previous = $db->selectOne(
            "SELECT r2.as_of, r2.statement_balance FROM bank_reconciliations r2 WHERE r2.company_id = ? AND r2.bank_account_id = ? AND r2.status = 'finished' AND r2.as_of < ? ORDER BY r2.as_of DESC LIMIT 1",
            [$companyId, $r->bank_account_id, $r->as_of],
        );
        $continuity = [
            'previous_as_of' => $previous === null ? null : (string) $previous->as_of,
            'previous_closing_balance' => $previous === null ? null : $m((int) $previous->statement_balance),
            // Null when there is nothing to compare with: the first reconciliation of the account, or a statement without an opening balance.
            'agrees' => $previous === null || $opening === null ? null : (int) $previous->statement_balance === $opening,
        ];

        $lessUnmatchedBook = (int) (0 - (int) $book['unmatched']);
        $steps = [
            ['key' => 'statement_closing', 'label' => 'Balance per bank statement', 'amount' => $m($closing)],
            ['key' => 'book_balance', 'label' => 'Balance per books', 'amount' => $m((int) $book['balance'])],
            ['key' => 'less_unmatched_book', 'label' => 'Less: book items not yet on the statement', 'amount' => $m($lessUnmatchedBook)],
            ['key' => 'add_unmatched_statement', 'label' => 'Add: statement items not yet in the books', 'amount' => $m((int) $unmatchedStatement['total']), 'of_which_excluded' => $m((int) $excluded['total'])],
            ['key' => 'add_late', 'label' => 'Add: items booked after the statement date that are already on it', 'amount' => $m($late)],
            ['key' => 'adjusted_book_balance', 'label' => 'Adjusted book balance', 'amount' => $m($adjusted)],
            ['key' => 'difference', 'label' => 'Difference (statement less adjusted book)', 'amount' => $m((int) $r->difference)],
        ];

        $bookItems = array_map(fn (array $i): array => $this->itemOut($i, $m), (array) $snapshot['unmatched_book_items']);
        $statementItems = array_map(fn (array $i): array => $this->itemOut($i, $m), (array) $snapshot['unmatched_statement_items']);

        $excludedRows = $db->select(
            "SELECT sl.id, sl.txn_date, sl.amount, sl.description, sl.excluded_reason, sl.excluded_at, eu.name AS excluded_by_name
             FROM bank_statement_lines sl JOIN bank_statements st ON st.id = sl.statement_id LEFT JOIN users eu ON eu.id = sl.excluded_by
             WHERE sl.company_id = ? AND sl.bank_account_id = ? AND st.period_to <= ? AND sl.status = 'excluded' ORDER BY sl.txn_date, sl.id",
            [$companyId, $r->bank_account_id, $r->period_to],
        );
        $excludedLines = array_map(fn (\stdClass $x): array => [
            'id' => (string) $x->id, 'date' => (string) $x->txn_date, 'amount' => $m((int) $x->amount), 'description' => (string) $x->description,
            'reason' => $x->excluded_reason === null ? null : (string) $x->excluded_reason, 'excluded_by' => $x->excluded_by_name === null ? null : (string) $x->excluded_by_name,
            'excluded_at' => $x->excluded_at === null ? null : (string) $x->excluded_at,
        ], $excludedRows);

        $matched = $db->selectOne('SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total FROM bank_matches WHERE company_id = ? AND reconciliation_id = ?', [$companyId, $reconciliationId]);

        $footing = $opening === null ? null : $opening + (int) $statement['receipts'] + (int) $statement['payments'] === $closing;
        $stepsAdd = (int) $book['balance'] - (int) $book['unmatched'] + (int) $unmatchedStatement['total'] + $late === $adjusted;

        return [
            'report' => 'bank_reconciliation',
            'currency' => $cur,
            'reconciliation' => [
                'id' => (string) $r->id, 'as_of' => (string) $r->as_of, 'finished_at' => (string) $r->finished_at,
                'finished_by' => $r->finished_by === null ? null : ['id' => (string) $r->finished_by, 'name' => $r->finished_by_name === null ? null : (string) $r->finished_by_name],
                'reopen_count' => (int) $r->reopen_count,
            ],
            'bank_account' => ['id' => (string) $r->bank_account_id, 'name' => (string) $r->account_name, 'bank_name' => $r->bank_name === null ? null : (string) $r->bank_name, 'account_number_masked' => $r->account_number_masked === null ? null : (string) $r->account_number_masked],
            'statement' => [
                'id' => (string) $r->statement_id, 'period_from' => (string) $r->period_from, 'period_to' => (string) $r->period_to, 'file_name' => $r->file_name === null ? null : (string) $r->file_name,
                'opening_balance' => $opening === null ? null : $m($opening), 'receipts' => $m((int) $statement['receipts']), 'payments' => $m((int) $statement['payments']),
                'closing_balance' => $m($closing), 'line_count' => (int) $statement['line_count'],
            ],
            'book' => [
                'balance' => $m((int) $book['balance']), 'opening_position' => $m((int) $book['opening_position']), 'matched' => $m((int) $book['matched']),
                'unmatched' => $m((int) $book['unmatched']), 'unmatched_count' => (int) $book['unmatched_count'], 'matched_after_as_of' => $m($late),
            ],
            'steps' => $steps,
            'checks' => [
                'statement_foots' => $footing,
                'steps_add_up' => $stepsAdd,
                'difference_is_zero' => (int) $r->difference === 0 && $closing - $adjusted === 0,
                'opening_continuity' => $continuity,
            ],
            'matched' => ['count' => (int) $matched->n, 'total' => $m((int) $matched->total)],
            'unmatched_book_items' => ['count' => (int) $book['unmatched_count'], 'total' => $m((int) $book['unmatched']), 'items' => $bookItems, 'truncated' => count($bookItems) < (int) $book['unmatched_count']],
            'unmatched_statement_items' => [
                'count' => (int) $unmatchedStatement['count'], 'total' => $m((int) $unmatchedStatement['total']), 'items' => $statementItems,
                'truncated' => count($statementItems) < (int) $unmatchedStatement['count'],
            ],
            'excluded_lines' => [
                'count' => (int) $excluded['count'], 'total' => $m((int) $excluded['total']), 'items' => $excludedLines,
                'list_agrees' => count($excludedLines) === (int) $excluded['count'],
            ],
        ];
    }

    /**
     * @param  array<string, mixed>  $item
     * @param  callable(int): array{amount: int, currency: string}  $m
     * @return array<string, mixed>
     */
    private function itemOut(array $item, callable $m): array
    {
        $item['amount'] = $m((int) $item['amount']);

        return $item;
    }
}
