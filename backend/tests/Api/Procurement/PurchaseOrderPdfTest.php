<?php

declare(strict_types=1);

use App\Contracts\HtmlToPdf;
use App\Models\Organisation\Company;
use App\Services\Documents\DocumentPdf;
use Tests\Support\FakePdfEngine;

/* The purchase order print (plan 3c.4): the approved order as stored, and a draft says it is a draft. */

beforeEach(function (): void {
    $this->setUpTrade();
    app()->instance(HtmlToPdf::class, new FakePdfEngine);
});

it('prints an approved order with its lines, supplier and totals, and a draft with a watermark', function (): void {
    $order = $this->approvedOrder();
    $html = $this->inTenant(fn () => app(DocumentPdf::class)->html('purchase_order', Company::query()->findOrFail($this->f->companyId), $order['id']));
    expect($html)->toContain('Purchase order')->toContain($order['number'])->toContain('Supplier')->toContain('Contact S1')->toContain('Authorised by')->not->toContain('class="watermark');

    $draft = $this->asPerson($this->accountant)->postJson($this->api('purchase-orders'), $this->orderBody(), $this->key())->assertCreated()->json('data');
    $html = $this->inTenant(fn () => app(DocumentPdf::class)->html('purchase_order', Company::query()->findOrFail($this->f->companyId), $draft['id']));
    expect($html)->toContain('DRAFT');

    $queued = $this->asPerson($this->accountant)->postJson($this->api("purchase-orders/{$order['id']}/pdf"), [], $this->key())->assertStatus(202)->json('data');
    $this->getJson($this->api("purchase-orders/{$order['id']}/pdf/{$queued['id']}"))->assertOk()->assertHeader('Content-Type', 'application/pdf');
});
