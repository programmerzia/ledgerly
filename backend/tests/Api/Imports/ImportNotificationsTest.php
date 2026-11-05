<?php

declare(strict_types=1);

use Tests\Support\BankingApi;
use Tests\Support\ImportsApi;
use Tests\Support\MakesApiCalls;
use Tests\Support\TradeApi;

/*
 * The bell tells whoever started an import how it ended (plan 3c.6), and nobody else.
 */

uses(MakesApiCalls::class, TradeApi::class, BankingApi::class, ImportsApi::class);

beforeEach(function (): void {
    $this->setUpBanking();
});

it('tells the person who started an import that it finished, with the counts, and no one else', function (): void {
    $csv = "Cust ID,Company Name,Email\nCUST-009,Dahabshiil Telecom Inc,billing@dahabshiil.so\nCUST-010,Telesom Somaliland Ltd,accounts@telesom.com\n";
    $import = $this->previewed('contacts', $csv, ['code' => 'Cust ID', 'name' => 'Company Name', 'email' => 'Email'], by: $this->accountant);
    $this->requestApply($import['id'], $this->accountant)->assertStatus(202);
    $this->runJob($import['id']);

    $mine = $this->asPerson($this->accountant)->getJson($this->api('notifications'))->assertOk()->json('data');
    expect($mine)->toHaveCount(1)
        ->and($mine[0])->toMatchArray(['kind' => 'import_finished', 'title' => 'Your import finished', 'subject_type' => 'import', 'subject_id' => $import['id'], 'link' => 'settings/import'])
        ->and($mine[0]['body'])->toBe('2 rows applied.');
    $this->asPerson($this->owner)->getJson($this->api('notifications'))->assertOk()->assertJsonCount(0, 'data');
});
