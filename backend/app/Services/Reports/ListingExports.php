<?php

declare(strict_types=1);

namespace App\Services\Reports;

use App\Http\Support\Json;
use App\Models\Organisation\Company;
use App\Queries\Audit\AuditTrail;
use App\Queries\Banking\BankReconciliationReport;
use App\Queries\Reports\JournalList;
use App\Queries\Reports\PeriodCloseChecklist;
use App\Support\Reports\Export\ReportRow;
use App\Support\Reports\Export\ReportTable;
use Carbon\CarbonImmutable;
use Generator;
use Illuminate\Validation\ValidationException;
use InvalidArgumentException;

/**
 * The listing and document reports of 3c.20 as export tables: journal list, bank reconciliation, audit trail and the
 * period close checklist. `ReportExport::plan()` hands the names in `NAMES` to this class, so the export route, the
 * limits and the audit of exports are the ones every report uses.
 */
final class ListingExports
{
    public const array NAMES = ['journal-list', 'bank-reconciliation', 'audit-trail', 'period-close'];

    public function __construct(
        private readonly JournalList $journals,
        private readonly BankReconciliationReport $reconciliation,
        private readonly AuditTrail $audit,
        private readonly PeriodCloseChecklist $checklist,
    ) {}

    /**
     * @param  array<string, mixed>  $input
     * @return array{table: ReportTable, rows: int}
     */
    public function plan(string $name, Company $company, array $input, int $decimals): array
    {
        return match ($name) {
            'journal-list' => $this->journalList($company, $input, $decimals),
            'bank-reconciliation' => $this->bankReconciliation($company, $input, $decimals),
            'audit-trail' => $this->auditTrail($company, $input, $decimals),
            'period-close' => $this->periodClose($company, $input, $decimals),
            default => throw new InvalidArgumentException("No listing report {$name}."),
        };
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array{table: ReportTable, rows: int}
     */
    private function journalList(Company $company, array $input, int $decimals): array
    {
        $withLines = (bool) ($input['include_lines'] ?? false);
        $cur = $company->base_currency;
        $count = $this->journals->count($company->id, $input);

        $generate = function () use ($company, $input, $withLines, $cur): Generator {
            $debit = 0;
            $credit = 0;
            $after = null;
            $query = $this->journals->page($company->id, $input)->orderBy('journal_date')->orderBy('id');
            $batch = [];
            $flush = function (array $batch) use ($company, $withLines, $cur): Generator {
                $lines = $withLines ? $this->journals->lines($company->id, array_values(array_map(fn ($j): string => (string) $j->id, $batch))) : [];
                foreach ($batch as $j) {
                    $source = $j->getAttribute('source_type') === null ? 'Manual' : str_replace('_', ' ', (string) $j->getAttribute('source_type'));
                    yield new ReportRow([
                        (string) ($j->number ?? 'Draft'), (string) Json::date($j->journal_date), $j->journal_type->value, $j->status->value,
                        (string) ($j->reference ?? ''), $source, (string) ($j->getAttribute('created_by_name') ?? ''), (string) ($j->getAttribute('posted_by_name') ?? ''), (string) ($j->memo ?? ''),
                        ['amount' => (int) $j->getAttribute('lines_debit'), 'currency' => $cur], ['amount' => (int) $j->getAttribute('lines_credit'), 'currency' => $cur],
                    ], $withLines ? 'heading' : 'normal');
                    foreach ($lines[(string) $j->id] ?? [] as $l) {
                        yield new ReportRow([
                            '', '', '', '', '', '', '', '', trim("{$l['account']['code']} {$l['account']['name']}".($l['description'] !== null && $l['description'] !== '' ? ' · '.$l['description'] : '')),
                            ['amount' => $l['debit'], 'currency' => $cur], ['amount' => $l['credit'], 'currency' => $cur],
                        ]);
                    }
                }
            };
            foreach ($query->cursor() as $j) {
                $debit += (int) $j->getAttribute('lines_debit');
                $credit += (int) $j->getAttribute('lines_credit');
                $batch[] = $j;
                if (count($batch) === 200) {
                    yield from $flush($batch);
                    $batch = [];
                }
            }
            yield from $flush($batch);
            yield new ReportRow(['', '', '', '', '', '', '', '', 'Total', ['amount' => $debit, 'currency' => $cur], ['amount' => $credit, 'currency' => $cur]], 'grand_total');
        };

        $table = new ReportTable('Journal list', $company->name.' · '.$this->journalSubtitle($input), [
            ['label' => 'Number', 'numeric' => false], ['label' => 'Date', 'numeric' => false], ['label' => 'Type', 'numeric' => false], ['label' => 'Status', 'numeric' => false],
            ['label' => 'Reference', 'numeric' => false], ['label' => 'Source', 'numeric' => false], ['label' => 'Created by', 'numeric' => false], ['label' => 'Posted by', 'numeric' => false],
            ['label' => $withLines ? 'Memo / account' : 'Memo', 'numeric' => false], ['label' => 'Debit', 'numeric' => true], ['label' => 'Credit', 'numeric' => true],
        ], $generate(), $decimals);

        return ['table' => $table, 'rows' => $count + 1 + ($withLines ? $this->lineCount($company->id, $input) : 0)];
    }

    /** @param array<string, mixed> $input */
    private function lineCount(string $companyId, array $input): int
    {
        // Upper bound for the choice between a streamed and a queued export; counting exactly would run the filter twice.
        return $this->journals->count($companyId, $input) * 3;
    }

    /** @param array<string, mixed> $input */
    private function journalSubtitle(array $input): string
    {
        $parts = [isset($input['period_id']) ? 'Period filter' : (($input['from'] ?? 'start').' to '.($input['to'] ?? 'today'))];
        foreach (['status' => 'Status', 'source' => 'Source', 'user_id' => 'Person'] as $key => $label) {
            if (isset($input[$key])) {
                $parts[] = "{$label}: {$input[$key]}";
            }
        }

        return implode(' · ', $parts);
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array{table: ReportTable, rows: int}
     */
    private function bankReconciliation(Company $company, array $input, int $decimals): array
    {
        if (! isset($input['reconciliation_id'])) {
            throw ValidationException::withMessages(['reconciliation_id' => ['Choose a finished reconciliation.']]);
        }
        $d = ($this->reconciliation)($company->id, (string) $input['reconciliation_id']);
        $rows = [];

        $rows[] = new ReportRow(['Bank account', "{$d['bank_account']['name']}".($d['bank_account']['account_number_masked'] !== null ? " ({$d['bank_account']['account_number_masked']})" : ''), null]);
        $rows[] = new ReportRow(['Statement', "{$d['statement']['period_from']} to {$d['statement']['period_to']}", null]);
        $rows[] = new ReportRow(['Finished', substr($d['reconciliation']['finished_at'], 0, 16).' by '.($d['reconciliation']['finished_by']['name'] ?? 'unknown'), null]);

        $rows[] = new ReportRow(['Statement balances'], 'heading');
        $rows[] = new ReportRow(['Opening balance', null, $d['statement']['opening_balance']]);
        $rows[] = new ReportRow(['Receipts', null, $d['statement']['receipts']]);
        $rows[] = new ReportRow(['Payments', null, $d['statement']['payments']]);
        $rows[] = new ReportRow(['Closing balance', null, $d['statement']['closing_balance']], 'total');

        $rows[] = new ReportRow(['Statement against books'], 'heading');
        foreach ($d['steps'] as $s) {
            $label = $s['label'].(isset($s['of_which_excluded']) && $s['of_which_excluded']['amount'] !== 0 ? ' (includes excluded lines)' : '');
            $rows[] = new ReportRow([$label, null, self::money($s['amount'])], in_array($s['key'], ['adjusted_book_balance', 'difference'], true) ? 'total' : 'normal');
        }
        $c = $d['checks'];
        $yes = fn (?bool $v): string => $v === null ? 'not applicable' : ($v ? 'yes' : 'NO');
        $rows[] = new ReportRow(['Checks'], 'heading');
        $rows[] = new ReportRow(['Opening + receipts + payments = closing balance', $yes($c['statement_foots']), null]);
        $rows[] = new ReportRow(['The steps add up to the adjusted book balance', $yes($c['steps_add_up']), null]);
        $rows[] = new ReportRow(['Difference is zero', $yes($c['difference_is_zero']), null]);
        $rows[] = new ReportRow(['Opening balance equals the previous statement\'s closing balance', $yes($c['opening_continuity']['agrees']), self::money($c['opening_continuity']['previous_closing_balance'])]);

        foreach (['unmatched_book_items' => 'Book items not on the statement', 'unmatched_statement_items' => 'Statement items not in the books'] as $key => $title) {
            $block = $d[$key];
            $rows[] = new ReportRow(["{$title} ({$block['count']})"], 'heading');
            foreach ($block['items'] as $i) {
                $rows[] = new ReportRow([trim(($i['date'] ?? '').' '.($i['number'] ?? '').' '.($i['description'] ?? '')), null, $i['amount']]);
            }
            if ($block['truncated']) {
                $rows[] = new ReportRow(['The first '.count($block['items']).' are listed; the total below covers all.', null, null]);
            }
            $rows[] = new ReportRow(["Total {$title}", null, $block['total']], 'total');
        }
        $rows[] = new ReportRow(["Excluded statement lines ({$d['excluded_lines']['count']})"], 'heading');
        foreach ($d['excluded_lines']['items'] as $i) {
            $rows[] = new ReportRow([trim("{$i['date']} {$i['description']}".($i['reason'] !== null ? " — {$i['reason']}" : '')), null, $i['amount']]);
        }
        $rows[] = new ReportRow(['Total excluded', null, $d['excluded_lines']['total']], 'total');

        $table = new ReportTable('Bank reconciliation', "{$company->name} · {$d['bank_account']['name']} · as of {$d['reconciliation']['as_of']}", [
            ['label' => 'Item', 'numeric' => false], ['label' => 'Detail', 'numeric' => false], ['label' => 'Amount', 'numeric' => true],
        ], $rows, $decimals);

        return ['table' => $table, 'rows' => count($rows)];
    }

    /** @return array{amount: int, currency: string}|null */
    private static function money(mixed $v): ?array
    {
        return is_array($v) && isset($v['amount'], $v['currency']) ? ['amount' => (int) $v['amount'], 'currency' => (string) $v['currency']] : null;
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array{table: ReportTable, rows: int}
     */
    private function auditTrail(Company $company, array $input, int $decimals): array
    {
        $count = $this->audit->count($company->id, $input);
        $generate = function () use ($company, $input): Generator {
            foreach ($this->audit->rows($company->id, $input) as $r) {
                yield new ReportRow([
                    (int) $r->id, CarbonImmutable::parse((string) $r->occurred_at)->utc()->format('Y-m-d H:i:s').' UTC', (string) $r->action,
                    (string) ($r->actor_name ?? ($r->actor_type.($r->actor_id !== null ? ' '.$r->actor_id : ''))), (string) ($r->subject_type ?? ''), (string) ($r->subject_id ?? ''),
                    (string) ($r->request_id ?? ''), (string) ($r->ip ?? ''), (string) $r->hash,
                ]);
            }
        };

        $filters = [];
        foreach (['action', 'actor_id', 'subject_type', 'subject_id'] as $k) {
            if (isset($input[$k])) {
                $filters[] = "{$k}: {$input[$k]}";
            }
        }
        $table = new ReportTable('Audit trail', $company->name.' · '.($input['from'] ?? 'start').' to '.($input['to'] ?? 'today').($filters === [] ? '' : ' · '.implode(', ', $filters)), [
            ['label' => 'Event', 'numeric' => false], ['label' => 'When', 'numeric' => false], ['label' => 'Action', 'numeric' => false], ['label' => 'Who', 'numeric' => false],
            ['label' => 'Subject', 'numeric' => false], ['label' => 'Subject id', 'numeric' => false], ['label' => 'Request', 'numeric' => false], ['label' => 'IP', 'numeric' => false],
            ['label' => 'Hash', 'numeric' => false],
        ], $generate(), $decimals);

        return ['table' => $table, 'rows' => $count];
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array{table: ReportTable, rows: int}
     */
    private function periodClose(Company $company, array $input, int $decimals): array
    {
        if (! isset($input['period_id'])) {
            throw ValidationException::withMessages(['period_id' => ['Choose a period.']]);
        }
        $d = ($this->checklist)($company->id, (string) $input['period_id']);
        $rows = [];
        foreach ($d['checks'] as $c) {
            $rows[] = new ReportRow([
                (string) $c['code'], strtoupper((string) $c['status']), (string) $c['message'],
                (string) ($c['waived_by'] ?? ''), (string) ($c['waived_reason'] ?? ''), (string) ($c['checked_at'] ?? ''),
            ]);
        }
        $s = $d['summary'];
        $rows[] = new ReportRow(['Total', "{$s['passed']} passed, {$s['waived']} waived, {$s['failed']} failed", '', '', '', ''], 'grand_total');
        $when = $d['source'] === 'live' ? 'as it stands now' : 'as recorded when the period closed';

        $table = new ReportTable('Period close checklist', "{$company->name} · {$d['period']['name']} ({$d['period']['starts_on']} to {$d['period']['ends_on']}) · {$d['period']['status']} · {$when}", [
            ['label' => 'Check', 'numeric' => false], ['label' => 'Result', 'numeric' => false], ['label' => 'Message', 'numeric' => false],
            ['label' => 'Waived by', 'numeric' => false], ['label' => 'Waiver reason', 'numeric' => false], ['label' => 'Checked at', 'numeric' => false],
        ], $rows, $decimals);

        return ['table' => $table, 'rows' => count($rows)];
    }
}
