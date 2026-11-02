<?php

declare(strict_types=1);

use App\Domain\Banking\AmountParser;
use App\Domain\Banking\CamtStatementParser;
use App\Domain\Banking\CsvStatementParser;
use App\Domain\Banking\LineHash;
use App\Domain\Banking\OfxStatementParser;
use App\Domain\Banking\ParsedLine;
use App\Domain\Banking\StatementFormatException;
use App\Domain\Banking\StatementLimits;
use App\Domain\Banking\StatementParsers;

/*
 * The March fixture statement, worked out by hand: +11,000.00, -15.00, -110.00 → +10,875.00 = 1,087,500 minor units.
 */
function bankFixture(string $name): string
{
    return (string) file_get_contents(__DIR__.'/../../fixtures/bank/'.$name);
}

function lineSummary(array $lines): array
{
    return array_map(fn (ParsedLine $l): array => [$l->txnDate, $l->amount, $l->reference], $lines);
}

const MARCH = [['2026-03-02', 1100000, 'INV-1'], ['2026-03-05', -1500, 'FEE-03'], ['2026-03-09', -11000, 'POS-77']];

it('parses amounts exactly in every declared locale, never as floats', function (string $raw, string $locale, int $expected): void {
    expect(AmountParser::parse($raw, $locale))->toBe($expected);
})->with([
    ['1,234.56', 'us', 123456], ['1.234,56', 'eu', 123456], ['1234.56', 'plain', 123456], ['1234,56', 'plain', 123456],
    ['-0.07', 'us', -7], ['(12.50)', 'us', -1250], ['12.50-', 'us', -1250], ['+3', 'us', 300], ['1,000,000.00', 'us', 100000000],
    ['0,10', 'eu', 10], ['19.99', 'plain', 1999], ['1 234,56', 'eu', 123456],
]);

it('refuses amounts it cannot read exactly', function (string $raw, string $locale): void {
    expect(fn () => AmountParser::parse($raw, $locale))->toThrow(InvalidArgumentException::class);
})->with([['1.234,56', 'us'], ['1,234.56', 'eu'], ['12.345', 'us'], ['abc', 'plain'], ['', 'us'], ['1,23', 'us'], ['9999999999999999.00', 'us']]);

it('allows extra zero decimals but not extra digits', function (): void {
    expect(AmountParser::parse('12.500', 'us'))->toBe(1250)->and(fn () => AmountParser::parse('12.501', 'us'))->toThrow(InvalidArgumentException::class);
});

it('reads a US CSV with thousands separators and a balance column', function (): void {
    $s = (new CsvStatementParser)->parse(bankFixture('march_us.csv'), ['locale' => 'us', 'columns' => ['date' => 'Date', 'description' => 'Description', 'reference' => 'Reference', 'amount' => 'Amount', 'balance' => 'Balance']]);

    expect(lineSummary($s->lines))->toBe(MARCH)->and($s->openingBalance)->toBe(0)->and($s->closingBalance)->toBe(1087500)
        ->and($s->periodFrom)->toBe('2026-03-02')->and(StatementParsers::balanceWarnings($s))->toBe([]);
});

it('reads a European CSV: semicolons, dd.mm.yyyy, 1.234,56 and separate debit and credit columns', function (): void {
    $s = (new CsvStatementParser)->parse(bankFixture('march_eu.csv'), [
        'delimiter' => ';', 'locale' => 'eu', 'date_format' => 'd.m.Y', 'sign' => 'columns',
        'columns' => ['date' => 'Buchungstag', 'description' => 'Text', 'reference' => 'Referenz', 'debit' => 'Soll', 'credit' => 'Haben'],
    ]);

    expect(lineSummary($s->lines))->toBe(MARCH)->and($s->openingBalance)->toBeNull()->and(StatementParsers::balanceWarnings($s))->toBe(['balances_not_provided']);
});

it('flips the sign when the bank shows money out as positive (card statements)', function (): void {
    $s = (new CsvStatementParser)->parse("d,t,a\n2026-03-02,Shop,25.00\n2026-03-03,Refund,-5.00\n", ['sign' => 'inverted', 'columns' => ['date' => 'd', 'description' => 't', 'amount' => 'a']]);

    expect(array_map(fn (ParsedLine $l): int => $l->amount, $s->lines))->toBe([-2500, 500]);
});

it('reads columns by index when there is no header', function (): void {
    $s = (new CsvStatementParser)->parse("2026-03-02|Shop|-1.50\n", ['delimiter' => '|', 'has_header' => false, 'columns' => ['date' => 0, 'description' => 1, 'amount' => 2]]);

    expect($s->lines[0]->amount)->toBe(-150);
});

it('names the line of every bad row', function (): void {
    try {
        (new CsvStatementParser)->parse(bankFixture('bad_lines.csv'), ['columns' => ['date' => 'Date', 'description' => 'Description', 'amount' => 'Amount']]);
        $this->fail('Expected a format error.');
    } catch (StatementFormatException $e) {
        expect(array_column($e->errors, 'line'))->toBe([3, 4])->and($e->getMessage())->toContain('Line 3');
    }
});

it('refuses an unclosed quote with its line, and a mapping to a missing column', function (): void {
    expect(fn () => (new CsvStatementParser)->parse("d,t,a\n2026-03-02,\"open,1.00\n", ['columns' => ['date' => 'd', 'description' => 't', 'amount' => 'a']]))
        ->toThrow(StatementFormatException::class, 'Line 2');
    expect(fn () => (new CsvStatementParser)->parse("d,t,a\n2026-03-02,x,1.00\n", ['columns' => ['date' => 'nope', 'description' => 't', 'amount' => 'a']]))
        ->toThrow(StatementFormatException::class, "no column 'nope'");
});

it('keeps embedded newlines and quotes in a field and still counts physical lines', function (): void {
    $s = (new CsvStatementParser)->parse("d,t,a\n2026-03-02,\"two\nlines \"\"q\"\"\",1.00\n2026-03-03,x,2.00\n", ['columns' => ['date' => 'd', 'description' => 't', 'amount' => 'a']]);

    expect($s->lines[0]->description)->toBe("two\nlines \"q\"")->and($s->lines[1]->sourceLine)->toBe(4);
});

it('reads OFX 1.x (SGML) and 2.x (XML) to the same lines; closing balance only, so the opening is not in the file', function (string $file): void {
    $s = (new OfxStatementParser)->parse(bankFixture($file));

    expect(lineSummary($s->lines))->toBe(MARCH)->and($s->closingBalance)->toBe(1087500)->and($s->openingBalance)->toBeNull()
        ->and($s->periodFrom)->toBe('2026-03-01')->and($s->periodTo)->toBe('2026-03-31')->and($s->currency)->toBe('USD')->and($s->accountId)->toBe('00112233');
})->with(['march.ofx', 'march_v2.ofx']);

it('decodes entities in SGML text', function (): void {
    expect((new OfxStatementParser)->parse(bankFixture('march.ofx'))->lines[2]->description)->toBe('Office supplies & paper');
});

it('reads CAMT.053 with both balances: credit entries in, debit entries out', function (): void {
    $s = (new CamtStatementParser)->parse(bankFixture('march_camt053.xml'));

    expect(lineSummary($s->lines))->toBe(MARCH)->and($s->openingBalance)->toBe(0)->and($s->closingBalance)->toBe(1087500)
        ->and($s->lines[0]->counterparty)->toBe('ACME LTD')->and($s->lines[1]->counterparty)->toBe('BANK')->and($s->currency)->toBe('USD')
        ->and(StatementParsers::balanceWarnings($s))->toBe([]);
});

it('warns when opening plus lines does not equal closing', function (): void {
    $xml = str_replace('<Amt Ccy="USD">10875.00</Amt>', '<Amt Ccy="USD">10876.00</Amt>', bankFixture('march_camt053.xml'));

    expect(StatementParsers::balanceWarnings((new CamtStatementParser)->parse($xml)))->toBe(['statement_balance_mismatch']);
});

it('refuses a DOCTYPE with an external entity (XXE) in CAMT and OFX XML, and never reads the file', function (string $file, string $parser): void {
    $xml = $file === 'xxe_ofx' ? str_replace('<OFX>', '<!DOCTYPE OFX [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]><OFX>', bankFixture('march_v2.ofx')) : bankFixture('xxe_camt053.xml');
    try {
        (new $parser)->parse($xml);
        $this->fail('Expected the DOCTYPE to be refused.');
    } catch (StatementFormatException $e) {
        expect($e->getMessage())->toContain('DTD')->and($e->getMessage())->not->toContain('root:');
    }
})->with([['xxe_camt', CamtStatementParser::class], ['xxe_ofx', OfxStatementParser::class]]);

it('refuses malformed XML with the line, a CAMT with two statements, and the wrong kind of file', function (): void {
    expect(fn () => (new CamtStatementParser)->parse("<Document>\n<Stmt>\n</Document>"))->toThrow(StatementFormatException::class);
    $two = str_replace('</BkToCstmrStmt>', '<Stmt></Stmt></BkToCstmrStmt>', bankFixture('march_camt053.xml'));
    expect(fn () => (new CamtStatementParser)->parse($two))->toThrow(StatementFormatException::class, 'more than one statement');
    expect(fn () => (new OfxStatementParser)->parse('hello'))->toThrow(StatementFormatException::class);
});

it('refuses oversize, empty and binary files before parsing', function (): void {
    $p = new StatementParsers;
    expect(fn () => $p->parse(str_repeat('a', StatementLimits::MAX_BYTES + 1), 'csv', []))->toThrow(StatementFormatException::class, 'larger than')
        ->and(fn () => $p->parse('  ', 'csv', []))->toThrow(StatementFormatException::class, 'empty')
        ->and(fn () => $p->parse("a\0b", 'csv', []))->toThrow(StatementFormatException::class, 'binary');
    $rows = "d,t,a\n".str_repeat("2026-03-02,x,1.00\n", StatementLimits::MAX_LINES + 1);
    expect(fn () => $p->parse($rows, 'csv', ['columns' => ['date' => 'd', 'description' => 't', 'amount' => 'a']]))->toThrow(StatementFormatException::class, 'more than');
});

it('sniffs the format from the content', function (): void {
    expect(StatementParsers::sniff(bankFixture('march.ofx')))->toBe('ofx')->and(StatementParsers::sniff(bankFixture('march_v2.ofx')))->toBe('ofx')
        ->and(StatementParsers::sniff(bankFixture('march_camt053.xml')))->toBe('camt')->and(StatementParsers::sniff(bankFixture('march_us.csv')))->toBe('csv');
});

it('hashes a line the same way every time, and tells identical lines in one file apart', function (): void {
    $a = new ParsedLine('2026-03-02', -450, 'Coffee ');
    $b = new ParsedLine('2026-03-02', -450, '  coffee');
    $one = LineHash::all('acct', [$a, $b, new ParsedLine('2026-03-02', -450, 'Tea')]);

    expect($one[0])->not->toBe($one[1])->and($one[2])->not->toBe($one[0])->and(LineHash::all('acct', [$a, $b, new ParsedLine('2026-03-02', -450, 'Tea')]))->toBe($one)
        ->and(LineHash::all('other', [$a])[0])->not->toBe($one[0])->and($one[0])->toHaveLength(64);
});
