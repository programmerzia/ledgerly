<?php

declare(strict_types=1);

namespace App\Domain\Banking;

/** Picks the parser for a declared (or sniffed) format and checks the statement's own arithmetic. */
final class StatementParsers
{
    public const array FORMATS = ['csv', 'ofx', 'camt'];

    /** @param array<string, mixed> $csvMapping */
    public function parse(string $content, string $format, array $csvMapping, int $scale = 2): ParsedStatement
    {
        if (strlen($content) > StatementLimits::MAX_BYTES) {
            throw StatementFormatException::at(null, 'statement_too_large', 'The file is larger than '.intdiv(StatementLimits::MAX_BYTES, 1024).' KB.');
        }
        if (trim($content) === '') {
            throw StatementFormatException::at(null, 'statement_empty', 'The file is empty.');
        }
        if (str_contains($content, "\0")) {
            throw StatementFormatException::at(null, 'statement_malformed', 'The file is binary, not a text statement.');
        }
        $format = $format === 'auto' ? self::sniff($content) : $format;
        if ($format === 'csv' && ! mb_check_encoding($content, 'UTF-8')) {
            $content = mb_convert_encoding($content, 'UTF-8', 'Windows-1252');
        }

        return match ($format) {
            'csv' => (new CsvStatementParser)->parse($content, $csvMapping, $scale),
            'ofx' => (new OfxStatementParser)->parse($content, $scale),
            'camt' => (new CamtStatementParser)->parse($content, $scale),
            default => throw StatementFormatException::at(null, 'statement_format_unknown', "Unknown statement format {$format}."),
        };
    }

    public static function sniff(string $content): string
    {
        $head = substr(ltrim($content, "\xEF\xBB\xBF \t\r\n"), 0, 2000);
        if (preg_match('/^OFXHEADER|<OFX[\s>]/i', $head) === 1) {
            return 'ofx';
        }
        if (stripos($head, 'camt.053') !== false || stripos($head, 'BkToCstmrStmt') !== false) {
            return 'camt';
        }

        return 'csv';
    }

    /**
     * Opening + lines = closing, when the file gives both (05 §10); a mismatch is a warning, not a refusal.
     *
     * @return list<string>
     */
    public static function balanceWarnings(ParsedStatement $s): array
    {
        if ($s->openingBalance === null || $s->closingBalance === null) {
            return ['balances_not_provided'];
        }

        return $s->openingBalance + $s->sum() === $s->closingBalance ? [] : ['statement_balance_mismatch'];
    }
}
