<?php

declare(strict_types=1);

namespace App\Queries\Reports;

use App\Domain\Shared\Fx;
use App\Http\Support\Json;
use App\Support\Reports\Dates;
use App\Support\Reports\ReportRunner;

/**
 * Receivables and payables aging as of a date, in base currency, per contact, bucketed by DUE date: current (not
 * yet due), 1-30, 31-60, 61-90 and 90+ days overdue (a document due on the as-of date is current, one due the day
 * before is 1 day late; 30 and 31, 60 and 61, 90 and 91 fall on either side of a boundary).
 *
 * As-of rules (kept simple; the same row counts the same way at every date):
 *  - A document counts when it was posted with issue_date <= as_of and is not reversed by then (a reversal counts from
 *    its reversal journal's date). Open = total - WHT, less the allocations of settlements dated <= as_of that are not
 *    reversed by then, less credit applications applied_on <= as_of that are not reversed by then (as target at their
 *    target amount, as source - a credit or debit note giving its credit - at their source amount).
 *  - "Reversed by then" always means the reversal JOURNAL date <= as_of; a settlement or application reversed later was still
 *    standing on the as-of date.
 *  - Credits are listed apart and never netted into the buckets (D9): open credit notes (debit notes for payables) and credit
 *    on account of receipts (payments) - the settlement's initial unallocated base, less what credit applications and refunds
 *    consumed by the as-of date. A refund (supplier refund) that left a debit on account is a negative credit.
 *  - So `totals.open - totals.credits` is the control account balance at the as-of date (payables as a credit balance), unless an
 *    unrealised-FX revaluation moved the control account.
 */
final class ArApAging
{
    private const array BUCKETS = ['current', 'days_1_30', 'days_31_60', 'days_61_90', 'days_over_90'];

    public function __construct(private readonly ReportRunner $runner) {}

    /** @return array<string, mixed> */
    public function __invoke(ReportParams $p, bool $receivable): array
    {
        $asOf = $p->to;
        $db = $this->runner->db();
        $cur = $p->currency;
        $docKinds = $receivable ? 'sales_invoice' : 'purchase_bill';
        $noteKind = $receivable ? 'credit_note' : 'debit_note';
        $setKinds = $receivable ? ['receipt', 'refund'] : ['payment', 'supplier_refund'];

        $docs = $db->select(<<<'SQL'
            SELECT i.id, i.number, i.kind::text AS kind, i.contact_id, i.issue_date, i.due_date, i.total - i.wht_amount AS net,
              (SELECT COALESCE(SUM(a.amount), 0) FROM settlement_allocations a JOIN settlements s ON s.id = a.settlement_id
                 LEFT JOIN journals sj ON sj.id = s.reversal_journal_id
                WHERE a.invoice_id = i.id AND s.status IN ('posted', 'reversed') AND s.settlement_date <= :d1 AND (s.status = 'posted' OR sj.journal_date > :d2)) AS allocated,
              (SELECT COALESCE(SUM(c.amount), 0) FROM credit_applications c LEFT JOIN journals cj ON cj.id = c.reversal_journal_id
                WHERE c.invoice_id = i.id AND c.applied_on <= :d3 AND (c.reversed_at IS NULL OR cj.journal_date > :d4)) AS applied_to,
              (SELECT COALESCE(SUM(c.source_amount), 0) FROM credit_applications c LEFT JOIN journals cj ON cj.id = c.reversal_journal_id
                WHERE c.note_id = i.id AND c.applied_on <= :d5 AND (c.reversed_at IS NULL OR cj.journal_date > :d6)) AS applied_from
            FROM invoices i LEFT JOIN journals rj ON rj.id = i.reversal_journal_id
            WHERE i.company_id = :company AND i.kind::text IN (:k1, :k2) AND i.status IN ('posted', 'reversed') AND i.issue_date <= :d7
              AND (i.status = 'posted' OR rj.journal_date > :d8)
            SQL, [
            'd1' => $asOf, 'd2' => $asOf, 'd3' => $asOf, 'd4' => $asOf, 'd5' => $asOf, 'd6' => $asOf, 'd7' => $asOf, 'd8' => $asOf,
            'company' => $p->companyId, 'k1' => $docKinds, 'k2' => $noteKind,
        ]);

        $settlements = $db->select(<<<'SQL'
            SELECT s.id, s.number, s.kind::text AS kind, s.contact_id, s.settlement_date, s.amount_fc, s.fx_rate,
              (SELECT COALESCE(SUM(a.amount_fc), 0) FROM settlement_allocations a WHERE a.settlement_id = s.id) AS allocated_fc,
              (SELECT COALESCE(SUM(c.source_amount), 0) FROM credit_applications c LEFT JOIN journals cj ON cj.id = c.reversal_journal_id
                WHERE c.settlement_id = s.id AND c.applied_on <= :d1 AND (c.reversed_at IS NULL OR cj.journal_date > :d2)) AS applied,
              (SELECT COALESCE(SUM(a.amount), 0) FROM settlement_allocations a JOIN settlements r ON r.id = a.settlement_id
                 LEFT JOIN journals rrj ON rrj.id = r.reversal_journal_id
                WHERE a.source_settlement_id = s.id AND r.status IN ('posted', 'reversed') AND r.settlement_date <= :d3 AND (r.status = 'posted' OR rrj.journal_date > :d4)) AS refunded
            FROM settlements s LEFT JOIN journals rj ON rj.id = s.reversal_journal_id
            WHERE s.company_id = :company AND s.kind::text IN (:k1, :k2) AND s.status IN ('posted', 'reversed') AND s.settlement_date <= :d5
              AND (s.status = 'posted' OR rj.journal_date > :d6)
            SQL, [
            'd1' => $asOf, 'd2' => $asOf, 'd3' => $asOf, 'd4' => $asOf, 'd5' => $asOf, 'd6' => $asOf,
            'company' => $p->companyId, 'k1' => $setKinds[0], 'k2' => $setKinds[1],
        ]);

        $empty = fn (): array => ['current' => 0, 'days_1_30' => 0, 'days_31_60' => 0, 'days_61_90' => 0, 'days_over_90' => 0, 'open' => 0, 'notes' => 0, 'on_account' => 0];
        /** @var array<string, array<string, int>> $byContact */
        $byContact = [];
        /** @var list<array<string, mixed>> $credits */
        $credits = [];
        /** @var array<string, string> $creditContact */
        $creditContact = [];

        foreach ($docs as $d) {
            $open = (int) $d->net - (int) $d->allocated - (int) $d->applied_to - (int) $d->applied_from;
            if ($open <= 0) {
                continue;
            }
            $contact = (string) $d->contact_id;
            $byContact[$contact] ??= $empty();
            if ($d->kind === $noteKind) {
                $byContact[$contact]['notes'] += $open;
                $credits[] = ['contact_id' => $contact, 'kind' => $noteKind, 'id' => $d->id, 'number' => $d->number, 'date' => $d->issue_date, 'amount' => $open];

                continue;
            }
            $due = (string) $d->due_date;
            $late = $asOf > $due ? Dates::days($due, $asOf) : 0;
            $bucket = match (true) {
                $late <= 0 => 'current', $late <= 30 => 'days_1_30', $late <= 60 => 'days_31_60', $late <= 90 => 'days_61_90', default => 'days_over_90',
            };
            $byContact[$contact][$bucket] += $open;
            $byContact[$contact]['open'] += $open;
        }

        foreach ($settlements as $s) {
            $left = (int) $s->allocated_fc >= (int) $s->amount_fc ? 0 : Fx::toBase((int) $s->amount_fc - (int) $s->allocated_fc, (string) $s->fx_rate, 2, 2);
            $left -= (int) $s->applied + (int) $s->refunded;
            if ($left <= 0) {
                continue;
            }
            $signed = $s->kind === $setKinds[0] ? $left : -$left;
            $contact = (string) $s->contact_id;
            $byContact[$contact] ??= $empty();
            $byContact[$contact]['on_account'] += $signed;
            $credits[] = ['contact_id' => $contact, 'kind' => $s->kind, 'id' => $s->id, 'number' => $s->number, 'date' => $s->settlement_date, 'amount' => $signed];
        }

        $people = $this->contacts($p->companyId, array_keys($byContact));
        $rows = [];
        $totals = $empty();
        foreach ($byContact as $id => $c) {
            $creditTotal = $c['notes'] + $c['on_account'];
            $rows[] = ['contact' => $people[$id], ...$this->moneyRow($c, $cur), 'credits' => Json::money($creditTotal, $cur), 'net' => Json::money($c['open'] - $creditTotal, $cur)];
            foreach ($c as $k => $v) {
                $totals[$k] += $v;
            }
        }
        usort($rows, fn (array $a, array $b): int => strcmp($a['contact']['name'], $b['contact']['name']));
        usort($credits, fn (array $a, array $b): int => [$a['contact_id'], $a['date'], $a['number']] <=> [$b['contact_id'], $b['date'], $b['number']]);
        $credits = array_map(fn (array $c): array => ['contact' => $people[$c['contact_id']], 'kind' => $c['kind'], 'id' => $c['id'], 'number' => $c['number'], 'date' => $c['date'], 'amount' => Json::money($c['amount'], $cur)], $credits);
        $creditTotal = $totals['notes'] + $totals['on_account'];

        return [
            'report' => $receivable ? 'ar_aging' : 'ap_aging',
            'currency' => $cur,
            'as_of' => $asOf,
            'buckets' => self::BUCKETS,
            'rows' => $rows,
            'credits' => $credits,
            'totals' => $this->moneyRow($totals, $cur) + ['credits' => Json::money($creditTotal, $cur), 'net' => Json::money($totals['open'] - $creditTotal, $cur)],
        ];
    }

    /**
     * @param  array<string, int>  $c
     * @return array<string, mixed>
     */
    private function moneyRow(array $c, string $cur): array
    {
        $out = [];
        foreach (self::BUCKETS as $b) {
            $out[$b] = Json::money($c[$b], $cur);
        }
        $out['open'] = Json::money($c['open'], $cur);
        $out['credit_notes'] = Json::money($c['notes'], $cur);
        $out['on_account'] = Json::money($c['on_account'], $cur);

        return $out;
    }

    /**
     * @param  list<int|string>  $ids
     * @return array<string, array{id: string, code: string, name: string}>
     */
    private function contacts(string $companyId, array $ids): array
    {
        if ($ids === []) {
            return [];
        }
        $out = [];
        $rows = $this->runner->db()->select(
            'SELECT id, code, name FROM contacts WHERE company_id = ? AND id IN ('.implode(', ', array_fill(0, count($ids), '?')).')',
            [$companyId, ...array_map(strval(...), $ids)],
        );
        foreach ($rows as $r) {
            $out[(string) $r->id] = ['id' => (string) $r->id, 'code' => (string) $r->code, 'name' => (string) $r->name];
        }

        return $out;
    }
}
