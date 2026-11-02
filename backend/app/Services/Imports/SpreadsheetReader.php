<?php

declare(strict_types=1);

namespace App\Services\Imports;

use App\Domain\Imports\ParsedSheet;
use App\Domain\Shared\DomainRuleViolation;
use DateInterval;
use DateTimeInterface;
use OpenSpout\Common\Entity\Cell;
use OpenSpout\Common\Entity\Cell\FormulaCell;
use OpenSpout\Reader\CSV\Options as CsvOptions;
use OpenSpout\Reader\CSV\Reader as CsvReader;
use OpenSpout\Reader\XLSX\Options as XlsxOptions;
use OpenSpout\Reader\XLSX\Reader as XlsxReader;
use Throwable;

/**
 * Reads the first sheet of a CSV or XLSX file (OpenSpout, streaming) into text cells. The first non-blank row is the header; data row
 * numbers are the sheet's own (header on row 1 → first data row 2), so an error points at the row the user sees in Excel. Everything is
 * capped (size, rows, columns, cell length) and a file that cannot be read is refused whole. A formula cell yields its cached result,
 * never the formula text. Nothing here writes to disk but the temporary files OpenSpout itself uses.
 */
final class SpreadsheetReader
{
    public function __construct(private readonly int $maxRows, private readonly int $maxColumns, private readonly int $maxCellLength) {}

    public static function fromConfig(): self
    {
        return new self((int) config('imports.max_rows'), (int) config('imports.max_columns'), (int) config('imports.max_cell_length'));
    }

    /** csv or xlsx: the content decides (an XLSX is a zip), the name only has to agree with it. */
    public static function formatOf(string $path, ?string $name): string
    {
        $head = (string) file_get_contents($path, false, null, 0, 4);
        $zip = str_starts_with($head, "PK\x03\x04");
        $ext = strtolower(pathinfo((string) $name, PATHINFO_EXTENSION));
        if ($zip) {
            if ($ext !== 'xlsx') {
                throw DomainRuleViolation::single('import_file_unreadable', 'Only .csv and .xlsx files can be imported.');
            }

            return 'xlsx';
        }
        if (! in_array($ext, ['csv', 'txt', ''], true)) {
            throw DomainRuleViolation::single('import_file_unreadable', 'Only .csv and .xlsx files can be imported.');
        }

        return 'csv';
    }

    public function read(string $path, string $format, ?string $delimiter = null): ParsedSheet
    {
        $reader = $format === 'xlsx'
            ? new XlsxReader(new XlsxOptions(SHOULD_FORMAT_DATES: false, SHOULD_PRESERVE_EMPTY_ROWS: true))
            : new CsvReader(new CsvOptions(SHOULD_PRESERVE_EMPTY_ROWS: true, FIELD_DELIMITER: $delimiter ?? $this->sniffDelimiter($path)));

        try {
            return $this->parse($reader, $path, $format);
        } catch (DomainRuleViolation $e) {
            throw $e;
        } catch (Throwable) {
            // OpenSpout's exceptions (a corrupt zip, bad XML, a missing sheet) carry paths and library detail; the caller needs only the verdict.
            throw DomainRuleViolation::single('import_file_unreadable', 'The file could not be read as a '.strtoupper($format).' spreadsheet.');
        } finally {
            try {
                $reader->close();
            } catch (Throwable) {
            }
        }
    }

    private function parse(XlsxReader|CsvReader $reader, string $path, string $format): ParsedSheet
    {
        if ($format === 'csv') {
            $sample = (string) file_get_contents($path, false, null, 0, 65536);
            if (str_contains($sample, "\0") || ! mb_check_encoding($sample, 'UTF-8')) {
                throw DomainRuleViolation::single('import_file_unreadable', 'The CSV file must be UTF-8 text.');
            }
        }
        $reader->open($path);

        $headers = [];
        $rows = [];
        $number = 0;
        foreach ($reader->getSheetIterator() as $sheet) {
            foreach ($sheet->getRowIterator() as $row) {
                $number++;
                if ($number > 2 * $this->maxRows + 100) {
                    throw DomainRuleViolation::single('import_too_many_rows', "The sheet runs past {$this->maxRows} data rows (blank rows count); split it into smaller files.");
                }
                $values = array_values(array_map(fn (Cell $c): string => $this->text($c), $row->cells));
                if ($headers === []) {
                    if (! $this->blank($values)) {
                        $headers = $this->headers($values);
                    }

                    continue;
                }
                if ($this->blank($values)) {
                    continue;
                }
                if (count($rows) >= $this->maxRows) {
                    throw DomainRuleViolation::single('import_too_many_rows', "The file has more than {$this->maxRows} data rows; split it into smaller files.");
                }
                $cells = [];
                foreach ($headers as $position => $name) {
                    $cells[$name] = $values[$position] ?? '';
                }
                // Anything past the last header is data without a column: refuse rather than drop it silently.
                if (count(array_filter(array_slice($values, count($headers)), fn (string $v) => trim($v) !== '')) > 0) {
                    throw DomainRuleViolation::single('import_malformed_row', "Row {$number} has more cells than the header row has columns.");
                }
                $rows[$number] = $cells;
            }

            break; // the first sheet only
        }
        if ($headers === []) {
            throw DomainRuleViolation::single('import_file_empty', 'The file has no header row.');
        }
        if ($rows === []) {
            throw DomainRuleViolation::single('import_file_empty', 'The file has a header but no data rows.');
        }

        return new ParsedSheet($format, array_values($headers), $rows);
    }

    /**
     * @param  list<string>  $values
     * @return array<int, string> position → header name; unnamed columns are skipped (their cells are not data)
     */
    private function headers(array $values): array
    {
        if (count($values) > $this->maxColumns) {
            throw DomainRuleViolation::single('import_too_many_columns', "The file has more than {$this->maxColumns} columns.");
        }
        $headers = [];
        $seen = [];
        foreach ($values as $i => $v) {
            $name = trim($v);
            if ($name === '') {
                continue;
            }
            if (isset($seen[mb_strtolower($name)])) {
                throw DomainRuleViolation::single('import_duplicate_header', "The column name '{$name}' appears twice in the header row.");
            }
            $seen[mb_strtolower($name)] = true;
            $headers[$i] = $name;
        }

        return $headers;
    }

    /** @param list<string> $values */
    private function blank(array $values): bool
    {
        foreach ($values as $v) {
            if (trim($v) !== '') {
                return false;
            }
        }

        return true;
    }

    private function text(Cell $cell): string
    {
        // A formula cell yields its cached result; one without a cached result yields the formula text, which the echo then neutralises.
        $value = $cell instanceof FormulaCell ? ($cell->getComputedValue() ?? $cell->getValue()) : $cell->getValue();
        $text = match (true) {
            $value === null => '',
            is_array($value) => implode('', array_map(fn ($run) => $run->text, $value)),
            is_bool($value) => $value ? 'true' : 'false',
            is_int($value) => (string) $value,
            is_float($value) => self::number($value),
            $value instanceof DateTimeInterface => $value->format('H:i:s') === '00:00:00' ? $value->format('Y-m-d') : $value->format('Y-m-d H:i:s'),
            $value instanceof DateInterval => $value->format('P%yY%mM%dDT%hH%iM%sS'),
            default => (string) $value,
        };
        if (mb_strlen($text) > $this->maxCellLength) {
            throw DomainRuleViolation::single('import_cell_too_long', "A cell is longer than {$this->maxCellLength} characters.");
        }

        return $text;
    }

    /** A float cell as the shortest decimal text that round-trips (never scientific notation). */
    private static function number(float $value): string
    {
        $text = rtrim(rtrim(number_format($value, 10, '.', ''), '0'), '.');

        return $text === '' || $text === '-0' ? '0' : $text;
    }

    private function sniffDelimiter(string $path): string
    {
        $head = (string) file_get_contents($path, false, null, 0, 8192);
        $line = strtok(ltrim($head, "\xEF\xBB\xBF\r\n"), "\n") ?: '';
        $best = ',';
        $max = 0;
        foreach ([',', ';', "\t", '|'] as $d) {
            $n = substr_count($line, $d);
            if ($n > $max) {
                $max = $n;
                $best = $d;
            }
        }

        return $best;
    }
}
