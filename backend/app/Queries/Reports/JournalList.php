<?php

declare(strict_types=1);

namespace App\Queries\Reports;

use App\Http\Support\Json;
use App\Models\Ledger\Journal;
use App\Support\Reports\ReportRunner;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Query\Builder as QueryBuilder;

/**
 * The journal list report (3c.20): the company's journals of any status, filtered by date range or period, status,
 * source document type and person, with their totals and, on request, their lines. It reads on the reporting
 * connection and writes nothing. A period filter is its date range (the journals dated in it), so a draft, which has no
 * fiscal period yet, is found too.
 *
 * `source`: a source document type (invoice, bill, payment …) or `none` for journals typed by hand.
 * `user_id` with `user_role` (created, submitted, approved or posted; created by default) picks the person.
 */
final class JournalList
{
    public function __construct(private readonly ReportRunner $runner, private readonly PeriodCalendar $calendar) {}

    /**
     * Journals ready for keyset pagination on (journal_date, id); each carries `lines_debit`, `lines_credit`, `line_count`
     * and the names of the people who made and posted it.
     *
     * @param  array<string, mixed>  $in  validated request input
     * @return Builder<Journal>
     */
    public function page(string $companyId, array $in): Builder
    {
        /** @var Builder<Journal> $query */
        $query = Journal::on((string) config('reports.connection'))->fromSub($this->base($companyId, $in), 'journals');

        return $query;
    }

    /**
     * The JSON body for a page of journals (from `page()`): rows, and on the first page the filter's choices.
     *
     * @param  list<Journal>|array<int, mixed>  $journals
     * @return array<string, mixed>
     */
    public function payload(string $companyId, string $currency, array $journals, bool $withLines, bool $withChoices): array
    {
        $lines = $withLines ? $this->lines($companyId, array_values(array_map(fn (mixed $j): string => $j instanceof Journal ? $j->id : '', $journals))) : null;
        $data = [];
        foreach ($journals as $j) {
            if (! $j instanceof Journal) {
                continue;
            }
            $row = [
                'id' => $j->id, 'number' => $j->number, 'date' => Json::date($j->journal_date), 'type' => $j->journal_type->value, 'status' => $j->status->value,
                'reference' => $j->reference, 'memo' => $j->memo,
                'source' => $j->source_type === null ? null : ['type' => $j->source_type, 'id' => $j->source_id],
                'created_by' => $j->created_by === null ? null : ['id' => $j->created_by, 'name' => $j->getAttribute('created_by_name')],
                'posted_by' => $j->posted_by === null ? null : ['id' => $j->posted_by, 'name' => $j->getAttribute('posted_by_name')],
                'posted_at' => Json::time($j->posted_at),
                'debit' => Json::money((int) $j->getAttribute('lines_debit'), $currency), 'credit' => Json::money((int) $j->getAttribute('lines_credit'), $currency),
                'line_count' => (int) $j->getAttribute('line_count'),
            ];
            if ($lines !== null) {
                $row['lines'] = array_map(fn (array $l): array => ['debit' => Json::money($l['debit'], $currency), 'credit' => Json::money($l['credit'], $currency)] + $l, $lines[$j->id] ?? []);
            }
            $data[] = $row;
        }

        return ['data' => $data] + ($withChoices ? ['choices' => $this->choices($companyId)] : []);
    }

    /** @param array<string, mixed> $in */
    public function count(string $companyId, array $in): int
    {
        return (int) $this->filtered($companyId, $in)->count();
    }

    /**
     * Lines of the given journals, by journal id, in line order.
     *
     * @param  list<string>  $journalIds
     * @return array<string, list<array<string, mixed>>>
     */
    public function lines(string $companyId, array $journalIds): array
    {
        if ($journalIds === []) {
            return [];
        }
        $rows = $this->runner->db()->table('journal_lines as l')
            ->join('accounts as a', 'a.id', '=', 'l.account_id')
            ->leftJoin('contacts as c', 'c.id', '=', 'l.contact_id')
            ->where('l.company_id', $companyId)->whereIn('l.journal_id', $journalIds)
            ->orderBy('l.journal_id')->orderBy('l.line_no')
            ->get(['l.id', 'l.journal_id', 'l.line_no', 'l.account_id', 'a.code as account_code', 'a.name as account_name', 'l.debit', 'l.credit', 'l.description', 'l.contact_id', 'c.name as contact_name']);
        $out = [];
        foreach ($rows as $r) {
            $out[(string) $r->journal_id][] = [
                'id' => (string) $r->id, 'line_no' => (int) $r->line_no,
                'account' => ['id' => (string) $r->account_id, 'code' => (string) $r->account_code, 'name' => (string) $r->account_name],
                'debit' => (int) $r->debit, 'credit' => (int) $r->credit, 'description' => $r->description === null ? null : (string) $r->description,
                'contact' => $r->contact_id === null ? null : ['id' => (string) $r->contact_id, 'name' => (string) $r->contact_name],
            ];
        }

        return $out;
    }

    /**
     * The choices the filter offers: source types and people that occur on this company's journals.
     *
     * @return array{sources: list<string>, users: list<array{id: string, name: string}>}
     */
    public function choices(string $companyId): array
    {
        $db = $this->runner->db();
        $sources = array_map(fn (\stdClass $r): string => (string) $r->source_type, $db->select('SELECT DISTINCT source_type FROM journals WHERE company_id = ? AND source_type IS NOT NULL ORDER BY source_type', [$companyId]));
        $users = array_map(fn (\stdClass $r): array => ['id' => (string) $r->id, 'name' => (string) $r->name], $db->select(
            'SELECT u.id, u.name FROM users u WHERE u.id IN (SELECT created_by FROM journals WHERE company_id = ? UNION SELECT posted_by FROM journals WHERE company_id = ? UNION SELECT approved_by FROM journals WHERE company_id = ? UNION SELECT submitted_by FROM journals WHERE company_id = ?) ORDER BY u.name',
            [$companyId, $companyId, $companyId, $companyId],
        ));

        return ['sources' => array_values($sources), 'users' => array_values($users)];
    }

    /** @param array<string, mixed> $in */
    private function base(string $companyId, array $in): QueryBuilder
    {
        return $this->filtered($companyId, $in)
            ->leftJoin('users as cu', 'cu.id', '=', 'j.created_by')
            ->leftJoin('users as pu', 'pu.id', '=', 'j.posted_by')
            ->select('j.*', 'cu.name as created_by_name', 'pu.name as posted_by_name')
            ->selectRaw('(SELECT COALESCE(SUM(l.debit), 0) FROM journal_lines l WHERE l.journal_id = j.id)::bigint AS lines_debit')
            ->selectRaw('(SELECT COALESCE(SUM(l.credit), 0) FROM journal_lines l WHERE l.journal_id = j.id)::bigint AS lines_credit')
            ->selectRaw('(SELECT COUNT(*) FROM journal_lines l WHERE l.journal_id = j.id) AS line_count');
    }

    /** @param array<string, mixed> $in */
    private function filtered(string $companyId, array $in): QueryBuilder
    {
        $q = $this->runner->db()->table('journals as j')->where('j.company_id', $companyId);
        $from = isset($in['from']) ? (string) $in['from'] : null;
        $to = isset($in['to']) ? (string) $in['to'] : null;
        if (isset($in['period_id'])) {
            $period = $this->calendar->find($companyId, (string) $in['period_id']);
            $from = $period?->startsOn;
            $to = $period?->endsOn;
            if ($period === null) {
                $q->whereRaw('false');
            }
        }
        if ($from !== null) {
            $q->where('j.journal_date', '>=', $from);
        }
        if ($to !== null) {
            $q->where('j.journal_date', '<=', $to);
        }
        if (isset($in['status'])) {
            $q->where('j.status', (string) $in['status']);
        }
        if (isset($in['source'])) {
            $in['source'] === 'none' ? $q->whereNull('j.source_type') : $q->where('j.source_type', (string) $in['source']);
        }
        if (isset($in['user_id'])) {
            $column = match ($in['user_role'] ?? 'created') {
                'submitted' => 'j.submitted_by',
                'approved' => 'j.approved_by',
                'posted' => 'j.posted_by',
                default => 'j.created_by',
            };
            $q->where($column, (string) $in['user_id']);
        }

        return $q;
    }
}
