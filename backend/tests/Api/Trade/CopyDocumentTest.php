<?php

declare(strict_types=1);

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/*
 * Copy to a new draft (plan 3c.34) has no endpoint of its own: the screen reads the source and creates a draft with
 * today's date and the same lines (the journal Duplicate pattern). What matters server side is that the create path
 * prices that copy at the rate in force on the NEW date and works out the due date itself, so a rate change between
 * the two dates is picked up and nothing of the source's amounts is carried over.
 */

beforeEach(function (): void {
    $this->setUpTrade();
});

/** @param  array<string, mixed>  $source */
function copyBodyOf(array $source, string $date): array
{
    return [
        'contact_id' => $source['contact_id'], 'issue_date' => $date, 'due_date' => null, 'currency' => $source['currency'],
        'reference' => $source['reference'], 'memo' => $source['memo'], 'kind' => $source['kind'],
        'lines' => array_map(fn (array $l): array => [
            'item_id' => $l['item_id'], 'account_id' => $l['account_id'], 'description' => $l['description'], 'quantity' => $l['quantity'],
            'unit_price_fc' => $l['unit_price_fc']['amount'], 'discount_pct' => $l['discount_pct'], 'tax_code_id' => $l['tax_code_id'],
        ], $source['lines']),
    ];
}

it('prices a copy at the tax rate in force on the new date, not the source date', function (): void {
    // VAT10 is 10% from 2020; from 2026-07-01 it is 15%.
    $this->inTenant(fn () => DB::table('tax_rates')->where('tax_code_id', $this->t->tax['VAT10'])->update(['effective_to' => '2026-06-30']));
    $this->inTenant(fn () => DB::table('tax_rates')->insert([
        'id' => (string) Str::uuid7(), 'tenant_id' => $this->f->tenantId, 'company_id' => $this->f->companyId,
        'tax_code_id' => $this->t->tax['VAT10'], 'rate' => '0.150000', 'effective_from' => '2026-07-01',
    ]));

    $source = $this->draftDoc('invoices', $this->t->body($this->t->customer, [[10000, '2', 'VAT10']], '2026-03-15'));
    expect($source['tax_total_fc']['amount'])->toBe(2000)->and($source['due_date'])->toBe('2026-04-14');
    $posted = $this->submitDoc('invoices', $source['id']);

    $read = $this->asPerson($this->accountant)->getJson($this->api("invoices/{$posted['id']}"))->assertOk()->json('data');
    $copy = $this->postJson($this->api('invoices'), copyBodyOf($read, '2026-11-05'), $this->key())->assertCreated()
        ->assertJsonPath('data.status', 'draft')->assertJsonPath('data.number', null)->assertJsonPath('data.issue_date', '2026-11-05')
        ->assertJsonPath('data.due_date', '2026-12-05')
        ->assertJsonPath('data.subtotal_fc.amount', 20000)->assertJsonPath('data.tax_total_fc.amount', 3000)->assertJsonPath('data.total_fc.amount', 23000)
        ->assertJsonPath('data.amount_due.amount', 0)->assertJsonPath('data.journal_id', null)->json('data');

    // The source is untouched, and the copy is a different document with no payment on it.
    expect($copy['id'])->not->toBe($posted['id'])->and($copy['settled_fc']['amount'] ?? 0)->toBe(0);
    $this->getJson($this->api("invoices/{$posted['id']}"))->assertOk()->assertJsonPath('data.tax_total_fc.amount', 2000)->assertJsonPath('data.number', $posted['number']);
});

it('refuses a copy dated where its tax code has no rate yet, naming the code', function (): void {
    $source = $this->draftDoc('invoices', $this->t->body($this->t->customer, [[10000, '1', 'VAT10']], '2026-03-15'));
    $read = $this->asPerson($this->accountant)->getJson($this->api("invoices/{$source['id']}"))->assertOk()->json('data');

    $this->postJson($this->api('invoices'), copyBodyOf($read, '2019-01-01'), $this->key())->assertUnprocessable();
});
