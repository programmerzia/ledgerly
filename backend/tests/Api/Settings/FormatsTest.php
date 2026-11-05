<?php

declare(strict_types=1);

use App\Models\Organisation\Company;
use App\Services\Documents\DocumentPdf;
use App\Services\Reports\ReportExport;
use App\Support\Reports\Export\PdfRenderer;
use Illuminate\Support\Facades\DB;

/*
 * Date and number formats by company (plan 3c.26b): one setting, defaulting from the country, read by the API's hint to the SPA, by
 * document PDFs and by report PDFs. CSV and XLSX values stay machine-readable, and money stays integer minor units.
 */

beforeEach(function (): void {
    $this->setUpTrade();
    $this->settings = fn () => $this->asPerson($this->owner)->getJson($this->api('settings'))->assertOk()->json('data');
    $this->choose = fn (array $body) => $this->asPerson($this->owner)->putJson($this->api('settings'), $body + ['version' => ($this->settings)()['version']], $this->key());
});

it('follows the country until the company chooses, and tells the SPA what is in force', function (): void {
    $formats = ($this->settings)()['formats'];
    expect($formats)->toMatchArray(['date' => 'mdy', 'number' => 'comma_dot', 'date_chosen' => null, 'number_chosen' => null])   // a US company
        ->and(collect($formats['date_options'])->pluck('key')->all())->toBe(['dmy', 'mdy', 'ymd', 'd_mon_y']);
    $this->asPerson($this->accountant)->getJson('/api/v1/companies')->assertOk()->assertJsonPath('data.0.formats', ['date' => 'mdy', 'number' => 'comma_dot']);

    ($this->choose)(['date_format' => 'dmy', 'number_format' => 'dot_comma'])->assertOk()
        ->assertJsonPath('data.formats.date', 'dmy')->assertJsonPath('data.formats.number', 'dot_comma')->assertJsonPath('data.formats.date_chosen', 'dmy');
    $this->asPerson($this->accountant)->getJson('/api/v1/companies')->assertJsonPath('data.0.formats', ['date' => 'dmy', 'number' => 'dot_comma']);

    // One key at a time; null puts that one back to the country's default, the other stays.
    ($this->choose)(['date_format' => null])->assertOk()->assertJsonPath('data.formats.date', 'mdy')->assertJsonPath('data.formats.date_chosen', null)->assertJsonPath('data.formats.number_chosen', 'dot_comma');
});

it('refuses unknown formats and people without settings.manage, and audits a change', function (): void {
    ($this->choose)(['date_format' => 'dd.mm.yy'])->assertStatus(422)->assertJsonValidationErrors(['date_format']);
    ($this->choose)(['number_format' => 'weird'])->assertStatus(422)->assertJsonValidationErrors(['number_format']);
    $this->asPerson($this->accountant)->putJson($this->api('settings'), ['date_format' => 'ymd', 'version' => 0], $this->key())->assertForbidden();

    ($this->choose)(['date_format' => 'ymd'])->assertOk();
    $event = $this->inTenant(fn () => DB::table('audit_events')->where('action', 'company_settings.updated')->orderByDesc('id')->first());
    expect(json_decode((string) $event->after, true)['settings']['date_format'])->toBe('ymd')->and(json_decode((string) $event->before, true)['settings']['date_format'])->toBeNull();
});

it('prints documents with the company format, and the ledger numbers underneath do not change', function (): void {
    $doc = $this->postedDoc('invoices', $this->t->body($this->t->customer, [[1234567, '1', 'ZERO']]));
    $html = fn () => $this->inTenant(fn () => app(DocumentPdf::class)->html('invoice', Company::query()->findOrFail($this->f->companyId), $doc['id']));

    expect($html())->toContain('03/15/2026')->toContain('12,345.67');           // US default: month first, comma-dot

    ($this->choose)(['date_format' => 'dmy', 'number_format' => 'dot_comma'])->assertOk();
    expect($html())->toContain('15/03/2026')->toContain('14/04/2026')->toContain('12.345,67')->not->toContain('12,345.67');

    ($this->choose)(['date_format' => 'd_mon_y', 'number_format' => 'space_comma'])->assertOk();
    expect($html())->toContain('15 Mar 2026')->toContain("12\u{202F}345,67");

    // The stored document is the same whatever the print format.
    expect($this->asPerson($this->owner)->getJson($this->api("invoices/{$doc['id']}"))->json('data.total_fc.amount'))->toBe($doc['total_fc']['amount'])
        ->and($this->inTenant(fn () => (int) DB::table('invoices')->where('id', $doc['id'])->value('total_fc')))->toBe($doc['total_fc']['amount']);
});

it('prints report PDFs with the company format but leaves CSV and the API machine-readable', function (): void {
    $this->sale(1234567, '2026-03-15');
    ($this->choose)(['date_format' => 'dmy', 'number_format' => 'dot_comma'])->assertOk();

    $table = $this->inTenant(fn () => app(ReportExport::class)->plan('profit-and-loss', Company::query()->findOrFail($this->f->companyId), ['from' => '2026-03-01', 'to' => '2026-03-31'])['table']);
    $html = app(PdfRenderer::class)->html($table);
    expect($html)->toContain('01/03/2026')->toContain('31/03/2026')->toContain('12.345,67')->not->toContain('12,345.67');

    $this->asPerson($this->accountant);
    $csv = $this->get($this->api('reports/profit-and-loss/export?from=2026-03-01&to=2026-03-31&format=csv'))->assertOk()->streamedContent();
    expect($csv)->toContain('2026-03-01')->toContain('12345.67')->not->toContain('12.345,67')->not->toContain('01/03/2026');

    $this->getJson($this->api('reports/profit-and-loss?from=2026-03-01&to=2026-03-31'))->assertOk()->assertJsonPath('data.from', '2026-03-01');
});
