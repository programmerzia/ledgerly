<?php

declare(strict_types=1);

namespace App\Domain\Banking;

use DOMElement;

/** OFX 1.x (SGML, unclosed leaf tags) and 2.x (XML). Bank (STMTRS) and card (CCSTMTRS) statements, one account per file. */
final class OfxStatementParser
{
    public function parse(string $content, int $scale = 2): ParsedStatement
    {
        $content = self::toUtf8($content);
        $isXml = preg_match('/^\s*(<\?xml|<\?OFX)/i', $content) === 1 && preg_match('/<OFX[\s>]/', $content) === 1 && ! str_starts_with(ltrim($content), 'OFXHEADER');
        [$head, $transactions] = $isXml ? $this->fromXml($content) : $this->fromSgml($content);

        $lines = [];
        $errors = [];
        foreach ($transactions as $tx) {
            $no = $tx['line'];
            $t = $tx['f'];
            try {
                $posted = $t['DTPOSTED'] ?? throw new \InvalidArgumentException('DTPOSTED is missing.');
                if (preg_match('/^(\d{8})/', $posted, $m) !== 1) {
                    throw new \InvalidArgumentException("'{$posted}' is not an OFX date.");
                }
                $amount = AmountParser::parse($t['TRNAMT'] ?? throw new \InvalidArgumentException('TRNAMT is missing.'), 'plain', $scale);
                if ($amount === 0) {
                    throw new \InvalidArgumentException('The amount is zero.');
                }
                $name = trim($t['NAME'] ?? '');
                $memo = trim($t['MEMO'] ?? '');
                $ref = trim($t['REFNUM'] ?? '') ?: (trim($t['CHECKNUM'] ?? '') ?: (trim($t['FITID'] ?? '') ?: null));
                $lines[] = new ParsedLine(
                    DateParser::parse($m[1], 'Ymd'), $amount, $memo !== '' ? $memo : $name,
                    null, $ref, $name !== '' ? $name : null, null, $no,
                );
            } catch (\InvalidArgumentException $e) {
                $errors[] = ['line' => $no, 'code' => 'line_invalid', 'message' => $e->getMessage()];
            }
            if (count($lines) + count($errors) > StatementLimits::MAX_LINES) {
                throw StatementFormatException::at(null, 'statement_too_large', 'The file has more than '.StatementLimits::MAX_LINES.' transactions.');
            }
        }
        if ($errors !== []) {
            throw StatementFormatException::many(array_slice($errors, 0, 20));
        }
        if ($lines === []) {
            throw StatementFormatException::at(null, 'statement_empty', 'The file has no transactions.');
        }

        $closing = null;
        $warnings = [];
        if (isset($head['BALAMT'])) {
            try {
                $closing = AmountParser::parse($head['BALAMT'], 'plain', $scale);
            } catch (\InvalidArgumentException $e) {
                throw StatementFormatException::at(null, 'statement_malformed', 'LEDGERBAL: '.$e->getMessage());
            }
        } else {
            $warnings[] = 'closing_balance_missing';
        }
        $dates = array_map(fn (ParsedLine $l): string => $l->txnDate, $lines);
        $from = isset($head['DTSTART']) && preg_match('/^(\d{8})/', $head['DTSTART'], $a) === 1 ? DateParser::parse($a[1], 'Ymd') : min($dates);
        $to = isset($head['DTEND']) && preg_match('/^(\d{8})/', $head['DTEND'], $b) === 1 ? DateParser::parse($b[1], 'Ymd') : max($dates);

        return new ParsedStatement('ofx', $lines, null, $closing, min($from, min($dates)), max($to, max($dates)), $head['CURDEF'] ?? null, $head['ACCTID'] ?? null, $warnings);
    }

    private static function toUtf8(string $c): string
    {
        $c = str_starts_with($c, "\xEF\xBB\xBF") ? substr($c, 3) : $c;
        if (preg_match('/^CHARSET:\s*(1252|ISO-8859-1|8859-1)/mi', substr($c, 0, 600)) === 1) {
            return mb_convert_encoding($c, 'UTF-8', 'Windows-1252');
        }
        if (! mb_check_encoding($c, 'UTF-8')) {
            throw StatementFormatException::at(null, 'statement_malformed', 'The file is not valid UTF-8.');
        }

        return $c;
    }

    /** @return array{0: array<string, string>, 1: list<array{line: int, f: array<string, string>}>} */
    private function fromSgml(string $c): array
    {
        if (stripos($c, '<OFX>') === false) {
            throw StatementFormatException::at(null, 'statement_malformed', 'This is not an OFX file (no <OFX> element).');
        }
        if (preg_match('/<!(DOCTYPE|ENTITY)/i', $c) === 1) {
            throw StatementFormatException::at(null, 'statement_malformed', 'DTDs and entity declarations are not allowed in a statement file.');
        }
        if (preg_match_all('/<ACCTID>\s*([^<\r\n]*)/i', $c, $ids) > 0 && count(array_unique(array_map('trim', $ids[1]))) > 1) {
            throw StatementFormatException::at(null, 'statement_multiple_accounts', 'The file holds more than one account; import one account per file.');
        }
        $get = fn (string $tag, string $within): ?string => preg_match('/'.$within.'/is', $c, $m) === 1 && isset($m[1]) ? trim($m[1]) : null;
        $head = array_filter([
            'CURDEF' => $get('CURDEF', '<CURDEF>\s*([^<\r\n]*)'),
            'ACCTID' => $ids[1][0] ?? null,
            'DTSTART' => $get('DTSTART', '<BANKTRANLIST>\s*<DTSTART>\s*([^<\r\n]*)'),
            'DTEND' => $get('DTEND', '<DTEND>\s*([^<\r\n]*)'),
            'BALAMT' => $get('BALAMT', '<LEDGERBAL>.*?<BALAMT>\s*([^<\r\n]*)'),
        ], fn (?string $v): bool => $v !== null && $v !== '');
        $head = array_map(fn ($v) => trim((string) $v), $head);

        $tx = [];
        // Line number of each STMTTRN start, for errors.
        $offset = 0;
        while (preg_match('/<STMTTRN>(.*?)(?=<\/STMTTRN>|<STMTTRN>|<\/BANKTRANLIST>|<\/CCSTMTRS>|<\/STMTRS>|$)/is', $c, $m, PREG_OFFSET_CAPTURE, $offset) === 1) {
            $offset = $m[0][1] + strlen($m[0][0]);
            $row = [];
            if (preg_match_all('/<([A-Z0-9.]+)>([^<\r\n]*)/', $m[1][0], $f, PREG_SET_ORDER) > 0) {
                foreach ($f as $kv) {
                    $row[$kv[1]] = htmlspecialchars_decode(trim($kv[2]), ENT_QUOTES | ENT_XML1);
                }
            }
            $tx[] = ['line' => substr_count(substr($c, 0, (int) $m[0][1]), "\n") + 1, 'f' => $row];
        }

        return [$head, $tx];
    }

    /** @return array{0: array<string, string>, 1: list<array{line: int, f: array<string, string>}>} */
    private function fromXml(string $c): array
    {
        $x = new XmlQuery(SafeXml::load($c));
        $p = XmlQuery::p(...);
        $accounts = [];
        foreach ($x->elements('//'.$p('ACCTID')) as $n) {
            $accounts[trim($n->textContent)] = true;
        }
        if (count($accounts) > 1) {
            throw StatementFormatException::at(null, 'statement_multiple_accounts', 'The file holds more than one account; import one account per file.');
        }
        $head = array_filter([
            'CURDEF' => $x->text('//'.$p('CURDEF')),
            'ACCTID' => (string) array_key_first($accounts),
            'DTSTART' => $x->text('//'.$p('BANKTRANLIST', 'DTSTART')),
            'DTEND' => $x->text('//'.$p('BANKTRANLIST', 'DTEND')),
            'BALAMT' => $x->text('//'.$p('LEDGERBAL', 'BALAMT')),
        ], fn (?string $v): bool => $v !== null && $v !== '');

        $tx = [];
        foreach ($x->elements('//'.$p('STMTTRN')) as $n) {
            $row = [];
            foreach ($n->childNodes as $child) {
                if ($child instanceof DOMElement) {
                    $row[strtoupper($child->localName ?? $child->nodeName)] = trim($child->textContent);
                }
            }
            $tx[] = ['line' => $n->getLineNo(), 'f' => $row];
        }

        return [$head, $tx];
    }
}
