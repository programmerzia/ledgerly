<?php

declare(strict_types=1);

use Illuminate\Support\Facades\DB;

/* Plan 3c.0 over HTTP: the comprehensive template, the hide/show endpoint, and extra posting keys. */

beforeEach(function (): void {
    $this->setUpWorld();
    $this->manager = $this->person('Fay Manager', ['Finance Manager']);
    $this->accountant = $this->person('Ann Accountant', ['Accountant']);
});

it('offers the comprehensive template as recommended, and only that one', function (): void {
    $beta = $this->secondCompany();
    $owner = $this->person('Owen Owner', ['Owner'], $beta->id);

    $rows = $this->asPerson($owner)->getJson($this->api('chart-templates', $beta->id))->assertOk()
        ->assertJsonStructure(['data' => [['code', 'name', 'country', 'standard', 'account_count', 'recommended']]])->json('data');
    $recommended = array_values(array_filter($rows, fn ($r) => $r['recommended']));

    expect($recommended)->toHaveCount(1)->and($recommended[0]['code'])->toBe('comprehensive')->and($recommended[0]['name'])->toBe('Comprehensive (IFRS)');
});

it('applies it, shows IFRS element and hidden flag, hides and shows with version checks, and keeps extra posting keys', function (): void {
    $beta = $this->secondCompany();
    $owner = $this->person('Owen Owner', ['Owner'], $beta->id);
    $this->asPerson($owner)->postJson($this->api('apply-chart-template', $beta->id), ['template_code' => 'comprehensive'], $this->key())->assertCreated();

    $all = $this->getJson($this->api('accounts?limit=200', $beta->id))->assertOk();
    $byCode = fn (string $code) => $this->inTenant(fn () => DB::table('accounts')->where('company_id', $beta->id)->where('code', $code)->value('id'));
    $cash = $byCode('11010000');
    $goodwill = $byCode('17010000');
    $this->getJson($this->api("accounts/{$cash}", $beta->id))->assertOk()
        ->assertJsonPath('data.is_hidden', false)->assertJsonPath('data.ifrs_element', 'CashOnHand');
    $this->getJson($this->api("accounts/{$goodwill}", $beta->id))->assertOk()
        ->assertJsonPath('data.is_hidden', true)->assertJsonPath('data.ifrs_element', 'Goodwill');
    expect($all->json('data'))->not->toBeEmpty();

    // The list can be filtered either way, and returns both by default.
    $hiddenOnly = $this->getJson($this->api('accounts?hidden=true&limit=200', $beta->id))->assertOk()->json('data');
    $shownOnly = $this->getJson($this->api('accounts?hidden=false&limit=200', $beta->id))->assertOk()->json('data');
    expect(collect($hiddenOnly)->every(fn ($a) => $a['is_hidden']))->toBeTrue()
        ->and(collect($shownOnly)->every(fn ($a) => ! $a['is_hidden']))->toBeTrue();

    // Show, then hide again; a stale version is refused; asking for the current state changes nothing.
    $this->putJson($this->api("accounts/{$goodwill}/visibility", $beta->id), ['hidden' => false, 'version' => 0], $this->key())
        ->assertOk()->assertJsonPath('data.is_hidden', false)->assertJsonPath('data.version', 1);
    $this->putJson($this->api("accounts/{$goodwill}/visibility", $beta->id), ['hidden' => true, 'version' => 0], $this->key())
        ->assertStatus(409)->assertJson(['code' => 'version_conflict']);
    $this->putJson($this->api("accounts/{$goodwill}/visibility", $beta->id), ['hidden' => false, 'version' => 1], $this->key())
        ->assertOk()->assertJsonPath('data.version', 1);
    $this->putJson($this->api("accounts/{$goodwill}/visibility", $beta->id), ['hidden' => 'maybe'], $this->key())
        ->assertStatus(422)->assertJsonValidationErrors(['hidden', 'version']);

    // An ordinary account edit does not undo the flag or the element.
    $this->putJson($this->api("accounts/{$goodwill}/visibility", $beta->id), ['hidden' => true, 'version' => 1], $this->key())->assertOk();
    $this->putJson($this->api("accounts/{$goodwill}", $beta->id), [
        'code' => '17010000', 'name' => 'Goodwill (renamed)', 'account_type' => 'asset', 'normal_balance' => 'debit', 'account_subtype' => 'Intangible Assets', 'version' => 2,
    ], $this->key())->assertOk()->assertJsonPath('data.is_hidden', true)->assertJsonPath('data.ifrs_element', 'Goodwill');

    // Settings tolerate the template's extra posting keys and keep them when an existing key changes.
    $before = $this->inTenant(fn () => json_decode((string) DB::table('company_settings')->where('company_id', $beta->id)->value('posting_accounts'), true));
    expect($before)->toHaveKeys(['bank_in_transit', 'bad_debt_expense', 'reverse_charge_output', 'goodwill', 'withholding_vat_receivable']);
    $settings = $this->getJson($this->api('settings', $beta->id))->assertOk();
    $other = $before['bank_in_transit'];
    $this->putJson($this->api('settings', $beta->id), ['posting_accounts' => ['bank_clearing' => $other], 'version' => $settings->json('data.version')], $this->key())->assertOk();
    $after = $this->inTenant(fn () => json_decode((string) DB::table('company_settings')->where('company_id', $beta->id)->value('posting_accounts'), true));
    expect($after)->toBe([...$before, 'bank_clearing' => $other]);
});

it('lets only an account manager hide or show an account', function (): void {
    $id = $this->f->account('1000');

    $this->asPerson($this->accountant)->putJson($this->api("accounts/{$id}/visibility"), ['hidden' => true, 'version' => 0], $this->key())->assertForbidden();
    $this->asPerson($this->manager)->putJson($this->api("accounts/{$id}/visibility"), ['hidden' => true, 'version' => 0], $this->key())
        ->assertOk()->assertJsonPath('data.is_hidden', true);
    expect($this->inTenant(fn () => DB::table('audit_events')->where('action', 'account.hidden')->count()))->toBe(1);
});
