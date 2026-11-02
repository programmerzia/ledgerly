<?php

declare(strict_types=1);

namespace App\Queries\Banking;

use App\Models\Banking\BankStatementLine;
use Illuminate\Database\DatabaseManager;
use Illuminate\Database\Eloquent\Builder;

/** Read side of banking: statement lines for a list, account figures and match suggestions. */
final class BankQueries
{
    public function __construct(private readonly DatabaseManager $db) {}

    /**
     * Statement lines with the id of their match and of a bank transaction waiting for approval.
     *
     * @param  array{status?: string|null, statement_id?: string|null, from?: string|null, to?: string|null, search?: string|null}  $filter
     * @return Builder<BankStatementLine>
     */
    public function lines(string $companyId, string $bankAccountId, array $filter): Builder
    {
        $q = BankStatementLine::query()->where('bank_statement_lines.company_id', $companyId)->where('bank_statement_lines.bank_account_id', $bankAccountId)
            ->select('bank_statement_lines.*')
            ->selectSub('select i.match_id from bank_match_items i where i.statement_line_id = bank_statement_lines.id limit 1', 'match_id')
            ->selectSub("select t.journal_id from bank_transactions t join journals j on j.id = t.journal_id where t.statement_line_id = bank_statement_lines.id and j.status = 'pending_approval' limit 1", 'pending_journal_id');
        foreach (['status' => 'status', 'statement_id' => 'statement_id'] as $key => $column) {
            if (! empty($filter[$key])) {
                $q->where("bank_statement_lines.{$column}", $filter[$key]);
            }
        }
        if (! empty($filter['from'])) {
            $q->where('txn_date', '>=', $filter['from']);
        }
        if (! empty($filter['to'])) {
            $q->where('txn_date', '<=', $filter['to']);
        }
        if (! empty($filter['search'])) {
            $term = '%'.str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], mb_strtolower((string) $filter['search'])).'%';
            $q->where(fn (Builder $w) => $w->whereRaw('lower(description) like ?', [$term])->orWhereRaw("lower(coalesce(reference, '')) like ?", [$term])->orWhereRaw("lower(coalesce(counterparty, '')) like ?", [$term]));
        }

        return $q;
    }

    public function lineWithState(string $companyId, string $lineId): ?BankStatementLine
    {
        return $this->lines($companyId, (string) BankStatementLine::query()->whereKey($lineId)->value('bank_account_id'), [])->where('bank_statement_lines.id', $lineId)->first();
    }

    /**
     * Book figures per bank account: balance (account currency) and statement lines still unmatched.
     *
     * @return array<string, array{book_balance: int, unreconciled_count: int}>
     */
    public function figures(string $companyId): array
    {
        $c = $this->db->connection();
        $book = $c->select(
            "select b.id, coalesce(sum(jl.amount_fc), 0) as balance from bank_accounts b
             left join journal_lines jl on jl.account_id = b.account_id and jl.currency = b.currency and jl.company_id = b.company_id
             left join journals j on j.id = jl.journal_id and j.status in ('posted', 'reversed')
             where b.company_id = ? and (jl.id is null or j.id is not null) group by b.id",
            [$companyId],
        );
        $open = $c->table('bank_statement_lines')->where('company_id', $companyId)->where('status', 'unmatched')->selectRaw('bank_account_id, count(*) as n')->groupBy('bank_account_id')->pluck('n', 'bank_account_id');
        $out = [];
        foreach ($book as $r) {
            $out[$r->id] = ['book_balance' => (int) $r->balance, 'unreconciled_count' => (int) ($open[$r->id] ?? 0)];
        }

        return $out;
    }

    /**
     * Posted, unmatched book lines on the line's bank account with exactly the line's amount, within the date window, best first. Each says
     * why: exact_amount always; reference_match when the line's reference appears in the journal's reference, memo or line text (or the
     * settlement's reference); date_window with the distance in days.
     *
     * @return list<array<string, mixed>>
     */
    public function suggestions(BankStatementLine $line, string $glAccountId, int $windowDays): array
    {
        $rows = $this->db->connection()->select(
            "select jl.id as journal_line_id, j.id as journal_id, j.number, j.journal_date, j.reference, j.memo, jl.description, jl.amount_fc as amount,
                    case when j.source_type = 'settlement' then j.source_id end as settlement_id, s.reference as settlement_reference,
                    abs(j.journal_date - ?::date) as days
             from journal_lines jl join journals j on j.id = jl.journal_id
             left join settlements s on s.id = j.source_id and j.source_type = 'settlement'
             where jl.company_id = ? and jl.account_id = ? and jl.currency = ? and jl.amount_fc = ? and j.status = 'posted' and j.reversal_of_id is null
               and abs(j.journal_date - ?::date) <= ?
               and not exists (select 1 from bank_match_items i where i.journal_line_id = jl.id)
             order by days, jl.id limit 25",
            [$line->txn_date->format('Y-m-d'), $line->company_id, $glAccountId, $line->currency, $line->amount, $line->txn_date->format('Y-m-d'), $windowDays],
        );
        $ref = mb_strtolower(trim((string) $line->reference));
        $out = [];
        foreach ($rows as $r) {
            $why = ['exact_amount'];
            $haystack = mb_strtolower(implode(' ', [(string) $r->reference, (string) $r->memo, (string) $r->description, (string) $r->settlement_reference]));
            $byRef = $ref !== '' && str_contains($haystack, $ref);
            if ($byRef) {
                $why[] = 'reference_match';
            }
            $days = (int) $r->days;
            $why[] = $days === 0 ? 'same_day' : "date_window:{$days}_days";
            $out[] = [
                'journal_line_id' => (string) $r->journal_line_id, 'journal_id' => (string) $r->journal_id,
                'number' => (string) $r->number, 'date' => (string) $r->journal_date,
                'amount' => (int) $r->amount, 'settlement_id' => $r->settlement_id === null ? null : (string) $r->settlement_id,
                'description' => (string) ($r->description ?? $r->memo),
                'score' => 60 + ($byRef ? 30 : 0) + max(0, 10 - $days), 'explanation' => $why,
            ];
        }
        usort($out, fn (array $a, array $b): int => $b['score'] <=> $a['score']);

        return $out;
    }
}
