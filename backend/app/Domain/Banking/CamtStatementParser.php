<?php

declare(strict_types=1);

namespace App\Domain\Banking;

use DOMElement;

/**
 * ISO 20022 camt.053 (bank to customer statement), any version: one Stmt per file. Opening balance is Bal OPBD
 * (else PRCD), closing is CLBD; credit entries are money in. Entries not booked (status other than BOOK) are
 * skipped with a warning; Ntry with several TxDtls stay one line with the entry amount.
 */
final class CamtStatementParser
{
    public function parse(string $content, int $scale = 2): ParsedStatement
    {
        $content = str_starts_with($content, "\xEF\xBB\xBF") ? substr($content, 3) : $content;
        $x = new XmlQuery(SafeXml::load($content));
        $stmts = $x->elements('//'.XmlQuery::p('Stmt'));
        if ($stmts === []) {
            throw StatementFormatException::at(null, 'statement_malformed', 'This is not a camt.053 file (no Stmt element).');
        }
        if (count($stmts) > 1) {
            throw StatementFormatException::at(null, 'statement_multiple_accounts', 'The file holds more than one statement; import one per file.');
        }
        $stmt = $stmts[0];
        $p = XmlQuery::p(...);

        $balance = function (array $codes) use ($x, $stmt, $scale, $p): ?int {
            foreach ($codes as $code) {
                foreach ($x->elements('./'.$p('Bal'), $stmt) as $bal) {
                    if ($x->text('./'.$p('Tp').'//'.$p('Cd'), $bal) !== $code) {
                        continue;
                    }
                    $amt = $x->node('./'.$p('Amt'), $bal);
                    if ($amt === null) {
                        continue;
                    }
                    try {
                        $v = AmountParser::parse((string) $amt->textContent, 'plain', $scale);
                    } catch (\InvalidArgumentException $e) {
                        throw StatementFormatException::at($amt->getLineNo(), 'statement_malformed', $e->getMessage());
                    }

                    return $x->text('./'.$p('CdtDbtInd'), $bal) === 'DBIT' ? -$v : $v;
                }
            }

            return null;
        };
        $opening = $balance(['OPBD', 'PRCD']);
        $closing = $balance(['CLBD']);

        $lines = [];
        $errors = [];
        $warnings = [];
        $n = 0;
        foreach ($x->elements('./'.$p('Ntry'), $stmt) as $entry) {
            $n++;
            $no = $entry->getLineNo();
            $status = $x->text('./'.$p('Sts'), $entry);
            if ($status !== null && ! in_array($status, ['BOOK', 'BOOKED'], true)) {
                $warnings[] = "entry_skipped_not_booked:{$no}";

                continue;
            }
            try {
                $amt = $x->text('./'.$p('Amt'), $entry) ?? throw new \InvalidArgumentException('Amt is missing.');
                $ind = $x->text('./'.$p('CdtDbtInd'), $entry);
                if (! in_array($ind, ['CRDT', 'DBIT'], true)) {
                    throw new \InvalidArgumentException('CdtDbtInd must be CRDT or DBIT.');
                }
                $amount = AmountParser::parse($amt, 'plain', $scale);
                if ($amount === 0) {
                    throw new \InvalidArgumentException('The amount is zero.');
                }
                $amount = $ind === 'DBIT' ? -$amount : $amount;
                $booked = $x->text('./'.$p('BookgDt', 'Dt'), $entry) ?? $x->text('./'.$p('BookgDt', 'DtTm'), $entry) ?? throw new \InvalidArgumentException('BookgDt is missing.');
                $value = $x->text('./'.$p('ValDt', 'Dt'), $entry) ?? $x->text('./'.$p('ValDt', 'DtTm'), $entry);
                $date = fn (string $s): string => DateParser::parse(substr($s, 0, 10), 'Y-m-d');
                $party = $x->text('.//'.$p('RltdPties').'/'.$p($ind === 'DBIT' ? 'Cdtr' : 'Dbtr').'//'.$p('Nm'), $entry);
                $remit = $x->text('.//'.$p('RmtInf', 'Ustrd'), $entry) ?? $x->text('./'.$p('AddtlNtryInf'), $entry);
                $ref = $x->text('.//'.$p('Refs', 'EndToEndId'), $entry);
                if ($ref === null || $ref === 'NOTPROVIDED') {
                    $ref = $x->text('./'.$p('AcctSvcrRef'), $entry) ?? $x->text('./'.$p('NtryRef'), $entry);
                }
                $lines[] = new ParsedLine($date($booked), $amount, $remit ?? $party ?? '', $value === null ? null : $date($value), $ref, $party, null, $no);
            } catch (\InvalidArgumentException $e) {
                $errors[] = ['line' => $no, 'code' => 'line_invalid', 'message' => $e->getMessage()];
            }
            if ($n > StatementLimits::MAX_LINES) {
                throw StatementFormatException::at(null, 'statement_too_large', 'The file has more than '.StatementLimits::MAX_LINES.' entries.');
            }
        }
        if ($errors !== []) {
            throw StatementFormatException::many(array_slice($errors, 0, 20));
        }
        if ($lines === []) {
            throw StatementFormatException::at(null, 'statement_empty', 'The file has no booked entries.');
        }

        $dates = array_map(fn (ParsedLine $l): string => $l->txnDate, $lines);
        $from = $x->text('./'.$p('FrToDt', 'FrDtTm'), $stmt);
        $to = $x->text('./'.$p('FrToDt', 'ToDtTm'), $stmt);
        $periodFrom = $from === null ? min($dates) : min(DateParser::parse(substr($from, 0, 10), 'Y-m-d'), min($dates));
        $periodTo = $to === null ? max($dates) : max(DateParser::parse(substr($to, 0, 10), 'Y-m-d'), max($dates));
        $account = $x->text('./'.$p('Acct', 'Id', 'IBAN'), $stmt) ?? $x->text('./'.$p('Acct', 'Id').'//'.$p('Id'), $stmt);
        $ccy = $x->elements('./'.$p('Bal', 'Amt'), $stmt)[0] ?? null;
        $currency = $x->text('./'.$p('Acct', 'Ccy'), $stmt) ?? ($ccy instanceof DOMElement ? $ccy->getAttribute('Ccy') : null);

        return new ParsedStatement('camt', $lines, $opening, $closing, $periodFrom, $periodTo, $currency === '' ? null : $currency, $account, $warnings);
    }
}
