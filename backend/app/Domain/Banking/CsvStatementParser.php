<?php

declare(strict_types=1);

namespace App\Domain\Banking;

/**
 * CSV with a declared column mapping:
 *   delimiter ("," ";" "\t" "|"), has_header, skip_rows (junk lines before the header), date_format (DateParser::FORMATS),
 *   locale (us|eu|plain, AmountParser), sign: "signed" (negative = money out), "inverted" (positive = money out, as on
 *   card statements) or "columns" (separate debit = out and credit = in columns), order: "asc"|"desc" (needed to read
 *   a balance column), columns: date, value_date, description, reference, counterparty, amount | debit + credit, balance;
 *   each is a header name or a 0-based index.
 * Errors name the physical line. Pure PHP, no framework.
 */
final class CsvStatementParser
{
    /** @param array<string, mixed> $mapping */
    public function parse(string $content, array $mapping, int $scale = 2): ParsedStatement
    {
        $delimiter = (string) ($mapping['delimiter'] ?? ',');
        if (! in_array($delimiter, [',', ';', "\t", '|'], true)) {
            throw StatementFormatException::at(null, 'mapping_invalid', 'The delimiter must be one of , ; tab |.');
        }
        $locale = (string) ($mapping['locale'] ?? 'plain');
        $dateFormat = (string) ($mapping['date_format'] ?? 'Y-m-d');
        if (! in_array($dateFormat, DateParser::FORMATS, true)) {
            throw StatementFormatException::at(null, 'mapping_invalid', 'Unsupported date format '.$dateFormat.'.');
        }
        $sign = (string) ($mapping['sign'] ?? 'signed');
        if (! in_array($sign, ['signed', 'inverted', 'columns'], true)) {
            throw StatementFormatException::at(null, 'mapping_invalid', 'The sign convention must be signed, inverted or columns.');
        }
        /** @var array<string, int|string|null> $cols */
        $cols = is_array($mapping['columns'] ?? null) ? $mapping['columns'] : [];
        $hasHeader = (bool) ($mapping['has_header'] ?? true);
        $skip = max(0, (int) ($mapping['skip_rows'] ?? 0));

        $records = self::records($content, $delimiter);
        $records = array_slice($records, $skip);
        $index = [];
        if ($hasHeader) {
            $header = array_shift($records);
            if ($header === null) {
                throw StatementFormatException::at(null, 'statement_empty', 'The file has no header row.');
            }
            foreach ($header[1] as $i => $name) {
                $index[mb_strtolower(trim($name))] = $i;
            }
        }
        $resolve = function (string $key, bool $required) use ($cols, $index, $hasHeader): ?int {
            $ref = $cols[$key] ?? null;
            if ($ref === null || $ref === '') {
                if ($required) {
                    throw StatementFormatException::at(null, 'mapping_invalid', "The column mapping needs '{$key}'.");
                }

                return null;
            }
            if (is_int($ref) || (ctype_digit($ref) && ! $hasHeader)) {
                return (int) $ref;
            }
            $pos = $index[mb_strtolower(trim((string) $ref))] ?? null;
            if ($pos === null) {
                throw StatementFormatException::at(null, 'mapping_invalid', "The file has no column '{$ref}' (mapped as {$key}).");
            }

            return $pos;
        };
        $cDate = $resolve('date', true);
        $cValue = $resolve('value_date', false);
        $cDesc = $resolve('description', true);
        $cRef = $resolve('reference', false);
        $cParty = $resolve('counterparty', false);
        $cBal = $resolve('balance', false);
        $cAmount = $sign === 'columns' ? null : $resolve('amount', true);
        $cDebit = $sign === 'columns' ? $resolve('debit', true) : null;
        $cCredit = $sign === 'columns' ? $resolve('credit', true) : null;

        if (count($records) > StatementLimits::MAX_LINES) {
            throw StatementFormatException::at(null, 'statement_too_large', 'The file has more than '.StatementLimits::MAX_LINES.' lines.');
        }

        $lines = [];
        $errors = [];
        foreach ($records as [$lineNo, $row]) {
            if (count($row) === 1 && trim($row[0]) === '') {
                continue; // blank line
            }
            try {
                $get = fn (?int $c): ?string => $c === null || ! isset($row[$c]) || trim($row[$c]) === '' ? null : trim($row[$c]);
                $date = $get($cDate) ?? throw new \InvalidArgumentException('The date is missing.');
                if ($sign === 'columns') {
                    $debit = $get($cDebit);
                    $credit = $get($cCredit);
                    if (($debit === null) === ($credit === null)) {
                        throw new \InvalidArgumentException('A line needs either a debit or a credit amount.');
                    }
                    $amount = $debit !== null ? -abs(AmountParser::parse($debit, $locale, $scale)) : abs(AmountParser::parse((string) $credit, $locale, $scale));
                } else {
                    $amount = AmountParser::parse($get($cAmount) ?? throw new \InvalidArgumentException('The amount is missing.'), $locale, $scale);
                    if ($sign === 'inverted') {
                        $amount = -$amount;
                    }
                }
                if ($amount === 0) {
                    throw new \InvalidArgumentException('The amount is zero.');
                }
                $bal = $get($cBal);
                $lines[] = new ParsedLine(
                    DateParser::parse($date, $dateFormat), $amount, $get($cDesc) ?? '',
                    $get($cValue) === null ? null : DateParser::parse((string) $get($cValue), $dateFormat),
                    $get($cRef), $get($cParty), $bal === null ? null : AmountParser::parse($bal, $locale, $scale), $lineNo,
                );
            } catch (\InvalidArgumentException $e) {
                $errors[] = ['line' => $lineNo, 'code' => 'line_invalid', 'message' => $e->getMessage()];
                if (count($errors) >= 20) {
                    break;
                }
            }
        }
        if ($errors !== []) {
            throw StatementFormatException::many($errors);
        }
        if ($lines === []) {
            throw StatementFormatException::at(null, 'statement_empty', 'The file has no statement lines.');
        }

        $opening = $closing = null;
        $warnings = [];
        if ($cBal !== null) {
            $desc = ($mapping['order'] ?? 'asc') === 'desc';
            $first = $desc ? $lines[count($lines) - 1] : $lines[0];
            $last = $desc ? $lines[0] : $lines[count($lines) - 1];
            if ($first->balanceAfter !== null && $last->balanceAfter !== null) {
                $opening = $first->balanceAfter - $first->amount;
                $closing = $last->balanceAfter;
            } else {
                $warnings[] = 'balance_column_incomplete';
            }
        }
        $dates = array_map(fn (ParsedLine $l): string => $l->txnDate, $lines);

        return new ParsedStatement('csv', $lines, $opening, $closing, min($dates), max($dates), null, null, $warnings);
    }

    /**
     * Splits into records with the physical line each starts on; quoted fields may hold the delimiter, quotes ("") and newlines.
     *
     * @return list<array{0: int, 1: list<string>}>
     */
    private static function records(string $content, string $delimiter): array
    {
        $content = str_starts_with($content, "\xEF\xBB\xBF") ? substr($content, 3) : $content;
        $content = str_replace(["\r\n", "\r"], "\n", $content);
        $out = [];
        $row = [];
        $field = '';
        $quoted = false;
        $line = 1;
        $start = 1;
        $n = strlen($content);
        for ($i = 0; $i < $n; $i++) {
            $c = $content[$i];
            if ($quoted) {
                if ($c === '"') {
                    if (($content[$i + 1] ?? '') === '"') {
                        $field .= '"';
                        $i++;
                    } else {
                        $quoted = false;
                    }
                } else {
                    if ($c === "\n") {
                        $line++;
                    }
                    $field .= $c;
                }
            } elseif ($c === '"' && $field === '') {
                $quoted = true;
            } elseif ($c === $delimiter) {
                $row[] = $field;
                $field = '';
            } elseif ($c === "\n") {
                $row[] = $field;
                $out[] = [$start, $row];
                $row = [];
                $field = '';
                $line++;
                $start = $line;
            } else {
                $field .= $c;
            }
        }
        if ($quoted) {
            throw StatementFormatException::at($start, 'statement_malformed', 'A quoted field is never closed.');
        }
        if ($field !== '' || $row !== []) {
            $row[] = $field;
            $out[] = [$start, $row];
        }

        return $out;
    }
}
