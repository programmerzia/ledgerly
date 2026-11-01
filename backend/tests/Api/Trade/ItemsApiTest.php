<?php

declare(strict_types=1);

use Illuminate\Support\Facades\DB;

beforeEach(function (): void {
    $this->setUpTrade();
    $this->viewer = $this->person('Vic Viewer', ['Viewer']);
});

it('creates, lists, updates with a version and deactivates items', function (): void {
    $this->asPerson($this->assistant); // items.manage is the sales assistant's right too
    $body = [
        'code' => 'WIDGET', 'name' => 'Widget', 'kind' => 'good', 'currency' => 'USD', 'sales_price' => 2500, 'purchase_price' => 1500,
        'sales_account_id' => $this->f->account('4000'), 'purchase_account_id' => $this->f->account('5000'), 'tax_code_id' => $this->t->tax['VAT10'],
    ];
    $item = $this->postJson($this->api('items'), $body, $this->key())->assertCreated()
        ->assertJsonPath('data.sales_price', ['amount' => 2500, 'currency' => 'USD'])->assertJsonPath('data.version', 0)->assertJsonPath('data.is_active', true)
        ->assertJsonPath('data.can.update', true)->json('data');

    $this->postJson($this->api('items'), $body, $this->key())->assertStatus(422)->assertJson(['code' => 'item_code_taken']);
    $this->postJson($this->api('items'), ['code' => 'bad code', 'name' => 'X', 'kind' => 'thing', 'currency' => 'ZZZ'], $this->key())->assertStatus(422)->assertJsonValidationErrors(['code', 'kind', 'currency']);
    // The withholding tax code is no default for a sale.
    $this->postJson($this->api('items'), [...$body, 'code' => 'W2', 'tax_code_id' => $this->t->tax['WHT10']], $this->key())->assertStatus(422)->assertJson(['code' => 'item_tax_code_invalid']);

    $this->putJson($this->api("items/{$item['id']}"), [...$body, 'sales_price' => 3000, 'version' => 0], $this->key())->assertOk()->assertJsonPath('data.sales_price.amount', 3000)->assertJsonPath('data.version', 1);
    $this->putJson($this->api("items/{$item['id']}"), [...$body, 'version' => 0], $this->key())->assertStatus(409)->assertJson(['code' => 'version_conflict', 'server_version' => 1]);

    $this->postJson($this->api('items'), [...$body, 'code' => 'GADGET', 'name' => 'Gadget', 'kind' => 'service'], $this->key())->assertCreated();
    $this->getJson($this->api('items'))->assertJsonCount(2, 'data')->assertJsonPath('data.0.code', 'GADGET');
    $this->getJson($this->api('items?kind=good'))->assertJsonCount(1, 'data')->assertJsonPath('data.0.code', 'WIDGET');
    $this->getJson($this->api('items?search=widg'))->assertJsonCount(1, 'data');

    $this->postJson($this->api("items/{$item['id']}/deactivate"), ['version' => 1], $this->key())->assertOk()->assertJsonPath('data.is_active', false)->assertJsonPath('data.can.deactivate', false);
    $this->getJson($this->api('items?active=true'))->assertJsonCount(1, 'data');
    $this->getJson($this->api("items/{$item['id']}"))->assertOk(); // deactivated, not deleted
    expect($this->inTenant(fn () => DB::table('items')->count()))->toBe(2);

    // An inactive item cannot go on a new document.
    $this->postJson($this->api('invoices'), ['contact_id' => $this->t->customer, 'issue_date' => '2026-03-15', 'lines' => [['item_id' => $item['id'], 'quantity' => '1']]], $this->key())
        ->assertStatus(422)->assertJson(['code' => 'item_inactive']);
});

it('lets a viewer read items but not manage them', function (): void {
    $item = $this->asPerson($this->owner)->postJson($this->api('items'), ['code' => 'A', 'name' => 'A', 'kind' => 'good', 'currency' => 'USD'], $this->key())->assertCreated()->json('data');
    $this->asPerson($this->viewer);
    $this->getJson($this->api('items'))->assertOk()->assertJsonCount(1, 'data');
    $this->getJson($this->api("items/{$item['id']}"))->assertOk()->assertJsonPath('data.can.update', false);
    $this->postJson($this->api('items'), ['code' => 'B', 'name' => 'B', 'kind' => 'good', 'currency' => 'USD'], $this->key())->assertForbidden();
    $this->putJson($this->api("items/{$item['id']}"), ['code' => 'A', 'name' => 'A', 'kind' => 'good', 'currency' => 'USD', 'version' => 0], $this->key())->assertForbidden();
    $this->postJson($this->api("items/{$item['id']}/deactivate"), ['version' => 0], $this->key())->assertForbidden();
});
