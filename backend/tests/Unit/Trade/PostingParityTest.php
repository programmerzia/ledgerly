<?php

declare(strict_types=1);

use App\Domain\Shared\DomainRuleViolation;
use App\Domain\Trade\BillDocument;
use App\Domain\Trade\BillPosting;
use App\Domain\Trade\DepreciationInput;
use App\Domain\Trade\DepreciationLine;
use App\Domain\Trade\DepreciationPosting;
use App\Domain\Trade\DocumentLine;
use App\Domain\Trade\InvoiceDocument;
use App\Domain\Trade\InvoicePosting;
use App\Domain\Trade\PostingAccounts;
use App\Domain\Trade\ProposedJournal;
use App\Domain\Trade\RealisedFx;
use App\Domain\Trade\RevaluationInput;
use App\Domain\Trade\RevaluationItem;
use App\Domain\Trade\RevaluationPosting;
use App\Domain\Trade\SettlementAllocation;
use App\Domain\Trade\SettlementDocument;
use App\Domain\Trade\SettlementPosting;

// Shared with frontend/tests/posting-parity.test.ts: docs/fixtures/posting/*.json (13 §9).

/** @return array<string, array{0: array<string, mixed>}> */
function postingFixtures(string $file): array
{
    $path = dirname(__DIR__, 4).'/docs/fixtures/posting/'.$file;
    /** @var list<array<string, mixed>> $cases */
    $cases = json_decode((string) file_get_contents($path), true, flags: JSON_THROW_ON_ERROR);
    $out = [];
    foreach ($cases as $case) {
        $out[(string) $case['name']] = [$case];
    }

    return $out;
}

/** @param array<string, mixed> $s */
function postingAccounts(array $s): PostingAccounts
{
    $p = $s['posting_accounts'];

    return new PostingAccounts($p['ar_control'], $p['ap_control'], $p['tax_output'], $p['tax_input'], $p['fx_realised'], $p['fx_unrealised'], $p['rounding'], $p['wht_payable']);
}

function rate(int|float|string $r): string
{
    return (string) $r;
}

/**
 * @param  array<string, mixed>  $d
 * @return list<DocumentLine>
 */
function docLines(array $d): array
{
    return array_map(static fn (array $l): DocumentLine => new DocumentLine(
        $l['id'], $l['account_id'], $l['description'], $l['line_total_fc'], $l['dimensions'], $l['tax_code_id'] ?? null,
    ), $d['lines']);
}

/** @param array<string, mixed> $case */
function assertParity(ProposedJournal $j, array $case): void
{
    $e = $case['expected'];
    $actualLines = array_map(static function ($l): array {
        $o = [
            'account_ref' => $l->accountRef, 'debit' => $l->debit, 'credit' => $l->credit, 'currency' => $l->currency,
            'fx_rate' => $l->fxRate, 'amount_fc' => $l->amountFc, 'dimensions' => $l->dimensions, 'description' => $l->description,
        ];
        if ($l->contactRef !== null) {
            $o['contact_ref'] = $l->contactRef;
        }
        if ($l->taxCodeRef !== null) {
            $o['tax_code_ref'] = $l->taxCodeRef;
        }

        return $o;
    }, $j->lines);
    $expectedLines = array_map(static function (array $l): array {
        $l['fx_rate'] = rate($l['fx_rate']);

        return $l;
    }, $e['lines']);

    expect($actualLines)->toEqual($expectedLines);
    expect(['debit' => $j->totalDebit(), 'credit' => $j->totalCredit()])->toEqual($e['totals']);
    expect([
        'journal_type' => $j->journalType->value, 'journal_date' => $j->journalDate, 'reference' => $j->reference,
        'memo' => $j->memo, 'source_type' => $j->sourceType, 'source_id' => $j->sourceId,
    ])->toEqual($e['journal']);
}

/**
 * @param  Closure(): ProposedJournal  $build
 * @param  array<string, mixed>  $case
 */
function assertOutcome(Closure $build, array $case): void
{
    if (isset($case['expected']['error'])) {
        expect($build)->toThrow(fn (DomainRuleViolation $e) => expect($e->errorCode)->toBe($case['expected']['error']));

        return;
    }
    assertParity($build(), $case);
}

it('posts a sales invoice identically to the mock', function (array $case): void {
    $d = $case['input']['invoice'];
    $doc = new InvoiceDocument(
        $d['id'], $d['number'], $d['reference'], $d['memo'] ?? null, $d['contact_id'], $d['issue_date'], $d['currency'],
        rate($d['fx_rate']), docLines($d), $d['tax_total_fc'], $d['tax_total'], $d['total_fc'],
    );
    assertOutcome(fn () => InvoicePosting::journal($doc, postingAccounts($case['input']['settings'])), $case);
})->with(postingFixtures('invoice.json'));

it('posts a purchase bill identically to the mock', function (array $case): void {
    $d = $case['input']['bill'];
    $doc = new BillDocument(
        $d['id'], $d['number'], $d['reference'], $d['memo'] ?? null, $d['contact_id'], $d['issue_date'], $d['currency'],
        rate($d['fx_rate']), docLines($d), $d['tax_total_fc'], $d['tax_total'], $d['total_fc'], $d['wht_amount_fc'] ?? 0,
    );
    assertOutcome(fn () => BillPosting::journal($doc, postingAccounts($case['input']['settings'])), $case);
})->with(postingFixtures('bill.json'));

it('posts a credit note identically to the mock', function (array $case): void {
    $d = $case['input']['credit_note'];
    $doc = new InvoiceDocument(
        $d['id'], $d['number'], $d['reference'], $d['memo'] ?? null, $d['contact_id'], $d['issue_date'], $d['currency'],
        rate($d['fx_rate']), docLines($d), $d['tax_total_fc'], $d['tax_total'], $d['total_fc'],
    );
    assertOutcome(fn () => InvoicePosting::creditNote($doc, postingAccounts($case['input']['settings'])), $case);
})->with(postingFixtures('credit_note.json'));

it('posts a debit note identically to the mock', function (array $case): void {
    $d = $case['input']['debit_note'];
    $doc = new BillDocument(
        $d['id'], $d['number'], $d['reference'], $d['memo'] ?? null, $d['contact_id'], $d['issue_date'], $d['currency'],
        rate($d['fx_rate']), docLines($d), $d['tax_total_fc'], $d['tax_total'], $d['total_fc'], $d['wht_amount_fc'] ?? 0,
    );
    assertOutcome(fn () => BillPosting::debitNote($doc, postingAccounts($case['input']['settings'])), $case);
})->with(postingFixtures('debit_note.json'));

it('posts a settlement identically to the mock', function (array $case): void {
    $d = $case['input']['settlement'];
    $allocs = array_map(static fn (array $a): SettlementAllocation => new SettlementAllocation(
        $a['id'], $a['invoice_number'], $a['allocated_amount_fc'], $a['allocated_amount_base'], $a['fx_gain_loss'],
        isset($a['invoice_fx_rate']) ? rate($a['invoice_fx_rate']) : null,
    ), $d['allocations']);
    $doc = new SettlementDocument(
        $d['id'], $d['kind'], $d['number'], $d['reference'], $d['memo'] ?? null, $d['contact_id'], $case['input']['bank_account_id'],
        $d['settlement_date'], $d['currency'], rate($d['fx_rate']), $d['amount_fc'], $d['amount'], $allocs, $d['dimensions'],
    );
    assertOutcome(fn () => SettlementPosting::journal($doc, postingAccounts($case['input']['settings']), $case['input']['settings']['base_currency']), $case);
})->with(postingFixtures('settlement.json'));

it('posts an fx revaluation identically to the mock', function (array $case): void {
    $d = $case['input']['revaluation'];
    $items = array_map(static fn (array $i): RevaluationItem => new RevaluationItem(
        $i['account_id'], $i['account_code'], $i['account_name'], $i['currency'], $i['amount_fc'], rate($i['current_rate']), $i['unrealised_gain_loss'],
    ), $d['items']);
    assertParity(RevaluationPosting::journal(new RevaluationInput($d['id'], $d['as_of'], $items, $d['dimensions']), postingAccounts($case['input']['settings']), $case['input']['settings']['base_currency']), $case);
})->with(postingFixtures('revaluation.json'));

it('posts a depreciation run identically to the mock', function (array $case): void {
    $d = $case['input']['depreciation'];
    $lines = array_map(static fn (array $l): DepreciationLine => new DepreciationLine(
        $l['asset_id'], $l['asset_number'], $l['asset_name'], $l['amount'],
    ), $d['lines']);
    $in = new DepreciationInput($d['id'], $d['as_of'], $case['input']['depreciation_expense_account'], $case['input']['accumulated_depreciation_account'], $lines, $case['input']['context']['base_currency'], $case['input']['context']['dimensions']);
    assertParity(DepreciationPosting::journal($in), $case);
})->with(postingFixtures('depreciation.json'));

it('every fixture journal balances unless flagged', function (): void {
    foreach (['invoice', 'credit_note', 'bill', 'debit_note', 'settlement', 'revaluation', 'depreciation'] as $f) {
        foreach (postingFixtures($f.'.json') as $name => [$case]) {
            if (isset($case['expected']['error'])) {
                continue;
            }
            expect($case['expected']['totals']['debit'])->toBe($case['expected']['totals']['credit'], $name);
        }
    }
});

it('computes realised FX by hand-checked numbers (D4)', function (array $case): void {
    $i = $case['input'];
    $fx = RealisedFx::of(
        $i['cash_in'], $i['allocated_fc'], rate($i['settlement_rate']), rate($i['invoice_rate']),
        $i['document_total_fc'], $i['document_total_base'], $i['settled_fc'], $i['settled_base'],
    );
    expect(['carried_base' => $fx->carriedBase, 'fx_gain_loss' => $fx->gainLoss])->toEqual($case['expected']);
})->with(postingFixtures('realised_fx.json'));
