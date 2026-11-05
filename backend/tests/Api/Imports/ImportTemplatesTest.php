<?php

declare(strict_types=1);

use Tests\Support\BankingApi;
use Tests\Support\ImportsApi;
use Tests\Support\MakesApiCalls;
use Tests\Support\TradeApi;

/*
 * Downloadable templates (plan 3c.36): one CSV per import kind, headed with the kind's field labels, so a file made from it
 * maps itself.
 */

uses(MakesApiCalls::class, TradeApi::class, BankingApi::class, ImportsApi::class);

beforeEach(function (): void {
    $this->setUpBanking();
});

it('serves a CSV template for every kind, headed with the field labels', function (string $kind): void {
    $kinds = array_column($this->asPerson($this->owner)->getJson($this->api('imports/kinds'))->assertOk()->json('data'), null, 'kind');

    $r = $this->asPerson($this->owner)->get($this->api("imports/kinds/{$kind}/template"))->assertOk();
    expect($r->headers->get('content-type'))->toContain('text/csv')->and($r->headers->get('content-disposition'))->toContain("{$kind}-template.csv");
    $header = str_getcsv(trim($r->streamedContent()));
    expect($header)->toBe(array_column($kinds[$kind]['fields'], 'label'));
})->with(['contacts', 'accounts', 'opening_balances', 'invoices', 'bank_lines']);

it('maps a file made from a template without any manual mapping', function (string $kind): void {
    $kinds = array_column($this->asPerson($this->owner)->getJson($this->api('imports/kinds'))->assertOk()->json('data'), null, 'kind');
    $header = trim($this->asPerson($this->owner)->get($this->api("imports/kinds/{$kind}/template"))->streamedContent());
    $row = implode(',', array_fill(0, count($kinds[$kind]['fields']), 'x'));

    $import = $this->upload($kind, "{$header}\n{$row}\n", match ($kind) {
        'opening_balances' => ['as_of' => '2026-01-01'],
        'bank_lines' => ['bank_account_id' => $this->bank],
        default => [],
    })->assertCreated()->json('data');
    expect(array_keys($import['suggested_mapping']['columns']))->toEqualCanonicalizing(array_column($kinds[$kind]['fields'], 'key'));
})->with(['contacts', 'accounts', 'opening_balances', 'invoices', 'bank_lines']);

it('answers 404 for a kind that does not exist', function (): void {
    $this->asPerson($this->owner)->getJson($this->api('imports/kinds/payroll/template'))->assertNotFound();
});
