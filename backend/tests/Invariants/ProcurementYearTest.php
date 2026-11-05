<?php

declare(strict_types=1);

use Illuminate\Support\Facades\DB;
use Tests\Support\MakesApiCalls;
use Tests\Support\ProcurementApi;
use Tests\Support\TradeApi;

uses(MakesApiCalls::class, TradeApi::class, ProcurementApi::class);

/*
 * Requisitions, orders and receipts take their number from the fiscal year their date falls in (plan 3c.16a), so a numbering rule applies
 * to them like to every other document. Numbers already issued never change, and a sequence that exists under the old calendar-year key
 * keeps counting, gapless.
 */

beforeEach(function (): void {
    $this->setUpTrade();
    // FY2026 is Jan-Dec 2026. Week-based years follow it: FY2027 is 2027-01-01 to 2027-12-30, so 2027-12-31 is already FY2028.
    foreach ([['FY2027', '2027-01-01'], ['FY2028', '2027-12-31']] as [$name, $start]) {
        $this->asPerson($this->owner)->postJson($this->api('fiscal-years'), ['name' => $name, 'starts_on' => $start, 'calendar' => '4-4-5'], $this->key())->assertCreated();
    }
    $this->order = fn (string $date) => $this->approvedOrder($this->orderBody(date: $date));
});

it('numbers by the fiscal year of the date, one gapless counter per fiscal year', function (): void {
    expect(($this->order)('2026-03-12')['number'])->toBe('PO-FY2026-00001')
        ->and(($this->order)('2026-04-02')['number'])->toBe('PO-FY2026-00002')
        ->and(($this->order)('2027-12-30')['number'])->toBe('PO-FY2027-00001')
        ->and(($this->order)('2027-12-31')['number'])->toBe('PO-FY2028-00001')   // the same calendar year, the next fiscal year
        ->and(($this->order)('2027-06-01')['number'])->toBe('PO-FY2027-00002');
});

it('applies a numbering rule to requisitions, orders and receipts from the next fiscal year, and renumbers nothing', function (): void {
    $first = ($this->order)('2026-03-12');
    $pr = $this->approvedRequisition($this->reqBody(date: '2026-03-10'));
    $receipt = $this->receive($first['id'], [[$first['lines'][0]['id'], '4']], '2026-03-20')->assertCreated()->json('data');
    expect([$first['number'], $pr['number'], $receipt['number']])->toBe(['PO-FY2026-00001', 'PR-FY2026-00001', 'GRN-FY2026-00001']);

    foreach (['purchase_order' => 'PUR', 'purchase_requisition' => 'REQ', 'goods_receipt' => 'GRC'] as $kind => $prefix) {
        $this->asPerson($this->owner)->putJson($this->api("numbering/{$kind}"), ['prefix' => $prefix, 'padding' => 6], $this->key())->assertOk()->assertJsonPath('meta.effective_from', '2027-01-01');
    }

    $order27 = ($this->order)('2027-02-10');
    $pr27 = $this->approvedRequisition($this->reqBody(date: '2027-02-09'));
    $receipt27 = $this->receive($order27['id'], [[$order27['lines'][0]['id'], '2']], '2027-02-20')->assertCreated()->json('data');
    expect([$order27['number'], $pr27['number'], $receipt27['number']])->toBe(['PUR-FY2027-000001', 'REQ-FY2027-000001', 'GRC-FY2027-000001']);

    // The year in progress is untouched, still gapless, and what was issued is as it was.
    expect(($this->order)('2026-05-05')['number'])->toBe('PO-FY2026-00002')
        ->and(($this->order)('2027-03-01')['number'])->toBe('PUR-FY2027-000002');
    $issued = $this->inTenant(fn () => DB::table('purchase_orders')->whereNotNull('number')->orderBy('number')->pluck('number')->all());
    expect($issued)->toContain('PO-FY2026-00001', 'PO-FY2026-00002', 'PUR-FY2027-000001', 'PUR-FY2027-000002');
});

it('keeps an existing calendar-year sequence counting, and a year with none starts under the fiscal year name', function (): void {
    // A company that was numbering by calendar year before this change: PO-2027-... with four issued.
    $this->inTenant(fn () => DB::table('sequences')->insert([
        'id' => (string) Str::uuid7(), 'tenant_id' => $this->f->tenantId, 'company_id' => $this->f->companyId,
        'sequence_key' => 'doc:purchase_order:2027', 'prefix' => 'PO-2027-', 'next_value' => 5, 'padding' => 5,
    ]));

    expect(($this->order)('2027-02-10')['number'])->toBe('PO-2027-00005')
        ->and(($this->order)('2027-06-10')['number'])->toBe('PO-2027-00006')
        // The old key goes on for the rest of that calendar year, as it always did...
        ->and(($this->order)('2027-12-31')['number'])->toBe('PO-2027-00007')
        // ...and a date in a year with no old sequence starts under the fiscal year's name.
        ->and(($this->order)('2028-02-10')['number'])->toBe('PO-FY2028-00001');
    $keys = $this->inTenant(fn () => DB::table('sequences')->where('sequence_key', 'like', 'doc:purchase_order:%')->orderBy('sequence_key')->pluck('next_value', 'sequence_key')->all());
    expect($keys)->toBe(['doc:purchase_order:2027' => 8, 'doc:purchase_order:FY2028' => 2]);
});

it('falls back to the calendar year for a date outside every fiscal year, as before', function (): void {
    expect(($this->order)('2031-01-05')['number'])->toBe('PO-2031-00001');
});
