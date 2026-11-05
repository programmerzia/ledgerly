<?php

declare(strict_types=1);

namespace App\Services\Reports;

use App\Models\Organisation\Company;
use App\Queries\Reports\GeneralLedger;
use App\Queries\Reports\LedgerLines;
use App\Queries\Reports\ReportParamsResolver;
use App\Queries\Reports\RunReport;
use App\Support\Formats\CompanyFormats;
use App\Support\Reports\Export\PdfRenderer;
use App\Support\Reports\Export\ReportRow;
use App\Support\Reports\Export\ReportTable;
use App\Support\Reports\Export\ReportTables;
use App\Support\Reports\Export\SpoutExporter;
use App\Support\Reports\ReportRunner;
use Generator;
use Illuminate\Validation\ValidationException;
use InvalidArgumentException;

/**
 * Exports of the report statements and the general ledger as XLSX, CSV (OpenSpout, streamed) or PDF
 * (Browsershot). The statements are taken from the same cache entry the API shows, so an export and the
 * screen never disagree. The ledger is read line by line and never held in memory.
 */
final class ReportExport
{
    public const array FORMATS = ['xlsx' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'csv' => 'text/csv; charset=UTF-8', 'pdf' => 'application/pdf'];

    /** URL names of every exportable report. */
    public const array REPORTS = ['trial-balance', 'profit-and-loss', 'balance-sheet', 'cash-flow', 'general-ledger', 'ar-aging', 'ap-aging', 'customer-statement', 'supplier-statement', 'tax-return', 'budget-vs-actual'];

    public function __construct(
        private readonly RunReport $statements,
        private readonly GeneralLedger $ledger,
        private readonly LedgerLines $lines,
        private readonly ReportParamsResolver $params,
        private readonly ReportRunner $runner,
        private readonly SpoutExporter $spout,
        private readonly PdfRenderer $pdf,
    ) {}

    /**
     * @param  array<string, mixed>  $input
     * @return array{table: ReportTable, rows: int}
     */
    public function plan(string $name, Company $company, array $input): array
    {
        $decimals = $this->decimals($company->base_currency);
        if ($name === 'general-ledger') {
            return $this->generalLedger($company, $input, $decimals);
        }
        $table = ReportTables::of(RunReport::STATEMENTS[$name] ?? throw new InvalidArgumentException("Unknown report {$name}."), ($this->statements)($name, $company, $input), $company->name, $decimals);
        $rows = is_array($table->rows) ? $table->rows : iterator_to_array($table->rows, false);

        return ['table' => new ReportTable($table->title, $table->subtitle, $table->columns, $rows, $decimals, CompanyFormats::for($company)), 'rows' => count($rows)];
    }

    /** Writes the table to a path (a file or `php://output`) in the format. */
    public function write(ReportTable $table, string $format, string $path): void
    {
        if ($format === 'pdf') {
            file_put_contents($path, $this->pdf->pdf($table));

            return;
        }
        $this->spout->write($table, $format, $path);
    }

    public function html(ReportTable $table): string
    {
        return $this->pdf->html($table);
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array{table: ReportTable, rows: int}
     */
    private function generalLedger(Company $company, array $input, int $decimals): array
    {
        $p = $this->params->lines($company, $input);
        $header = $this->ledger->header($p);
        $filter = $this->ledger->filter($p);
        $rows = $this->ledger->account($p);
        $opening = $header['opening_balance']['amount'];
        $count = $header['summary']['line_count'];
        $cur = $company->base_currency;

        $generate = function () use ($filter, $rows, $opening, $cur, $header): Generator {
            yield new ReportRow(['', 'Opening balance', '', '', null, null, ['amount' => $opening, 'currency' => $cur]], 'heading');
            $balance = $opening;
            $query = $this->lines->page($filter)->orderBy('journal_date')->orderBy('id');
            foreach ($query->cursor() as $line) {
                $balance += $rows->natural($line->debit, $line->credit);
                yield new ReportRow([
                    (string) $line->getAttribute('journal_date'), (string) $line->getAttribute('journal_number'),
                    (string) $line->getAttribute('journal_reference'), (string) $line->description,
                    ['amount' => $line->debit, 'currency' => $cur], ['amount' => $line->credit, 'currency' => $cur],
                    ['amount' => $balance, 'currency' => $cur],
                ]);
            }
            yield new ReportRow(['', 'Closing balance', '', '', $header['summary']['debit'], $header['summary']['credit'], $header['closing_balance']], 'grand_total');
        };

        $table = new ReportTable(
            'General ledger',
            "{$company->name} · {$header['account']['code']} {$header['account']['name']} · ".($header['from'] ?? 'start').' to '.($header['to'] ?? 'today'),
            [
                ['label' => 'Date', 'numeric' => false], ['label' => 'Journal', 'numeric' => false], ['label' => 'Reference', 'numeric' => false],
                ['label' => 'Description', 'numeric' => false], ['label' => 'Debit', 'numeric' => true], ['label' => 'Credit', 'numeric' => true],
                ['label' => 'Balance', 'numeric' => true],
            ],
            $generate(),
            $decimals,
            CompanyFormats::for($company),
        );

        return ['table' => $table, 'rows' => $count + 2];
    }

    private function decimals(string $currency): int
    {
        $row = $this->runner->db()->selectOne('SELECT minor_unit FROM currencies WHERE code = ?', [$currency]);
        if ($row === null) {
            throw ValidationException::withMessages(['currency' => ['Unknown currency.']]);
        }

        return (int) $row->minor_unit;
    }
}
