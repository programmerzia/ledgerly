<?php

declare(strict_types=1);

use App\Actions\Tax\Inputs\TaxCodeInput;
use App\Actions\Tax\Inputs\TaxGroupInput;
use App\Actions\Tax\Inputs\TaxRateInput;
use App\Actions\Tax\ManageTaxCode;
use App\Actions\Tax\ManageTaxGroup;
use App\Actions\Trade\Inputs\ContactInput;
use App\Actions\Trade\ManageContact;
use App\Domain\Shared\DomainRuleViolation;
use App\Domain\Tax\TaxCalculator;
use App\Domain\Tax\TaxLine;
use App\Domain\Tax\TaxRounding;
use App\Queries\Tax\TaxRateResolver;
use App\Support\ActorType;
use Illuminate\Support\Facades\DB;
use Tests\Support\LedgerFixture;

/* Rates by effective date, a group's components, a contact's withholding rate and the company rounding mode, feeding the D2 calculator. */

beforeEach(function (): void {
    $this->grant('tax.manage', 'contacts.manage', 'contacts.manage_customers');
    $this->f = LedgerFixture::create();
    $this->codes = app(ManageTaxCode::class);
    $this->resolver = app(TaxRateResolver::class);
    $this->day = fn (string $d): DateTimeImmutable => new DateTimeImmutable($d);
});

function newCode(object $t, string $code, string $kind, string $rate, string $from = '2026-01-01'): string
{
    return $t->codes->create($t->f->actor, new TaxCodeInput($t->f->companyId, $code, $code, $kind), new TaxRateInput($rate, new DateTimeImmutable($from)))->id;
}

it('finds the rate in force on a date and nothing outside its rates', function (): void {
    $id = newCode($this, 'VAT', 'vat', '0.05');
    $this->codes->addRate($this->f->actor, $id, 0, new TaxRateInput('0.075', ($this->day)('2026-07-01')));

    expect($this->resolver->rateOn($id, ($this->day)('2025-12-31')))->toBeNull()
        ->and($this->resolver->rateOn($id, ($this->day)('2026-06-30')))->toBe('0.050000')
        ->and($this->resolver->rateOn($id, ($this->day)('2026-07-01')))->toBe('0.075000')
        ->and(fn () => $this->resolver->requireRateOn($id, ($this->day)('2025-01-01')))->toThrow(DomainRuleViolation::class, 'no rate on 2025-01-01');
});

it('resolves a group into components in sequence and feeds the calculator', function (): void {
    $state = newCode($this, 'STATE', 'sales', '0.10');
    $city = newCode($this, 'CITY', 'sales', '0.05');
    $group = app(ManageTaxGroup::class)->create($this->f->actor, new TaxGroupInput($this->f->companyId, 'LOCAL', 'Local', [
        ['tax_code_id' => $state, 'compound' => false], ['tax_code_id' => $city, 'compound' => true],
    ]));

    $components = $this->resolver->groupComponents($group->id, ($this->day)('2026-03-15'));
    expect(array_map(fn ($c) => [$c->taxCodeId, $c->compound], $components))->toBe([[$state, false], [$city, true]]);

    // 1000 net: 100 + (1000 + 100) x 5% = 55.
    $r = TaxCalculator::calculate([new TaxLine(1000, $components)], $this->resolver->roundingFor($this->f->companyId));
    expect($r->byCode)->toBe([$state => 100, $city => 55]);

    // A rate that does not exist yet on the document date is an error, not a silent zero.
    expect(fn () => $this->resolver->groupComponents($group->id, ($this->day)('2025-06-01')))->toThrow(DomainRuleViolation::class);
});

it('looks up a contact\'s withholding rate by date', function (): void {
    $wht = newCode($this, 'WHT10', 'wht', '0.10');
    $this->codes->addRate($this->f->actor, $wht, 0, new TaxRateInput('0.15', ($this->day)('2026-09-01')));
    $contacts = app(ManageContact::class);
    $with = $contacts->create($this->f->actor, new ContactInput($this->f->companyId, 'supplier', 'S1', 'Supplier', 'USD', whtCodeId: $wht));
    $without = $contacts->create($this->f->actor, new ContactInput($this->f->companyId, 'supplier', 'S2', 'Plain', 'USD'));

    expect($this->resolver->withholdingRate($with->id, ($this->day)('2026-03-15')))->toBe('0.100000')
        ->and($this->resolver->withholdingRate($with->id, ($this->day)('2026-09-01')))->toBe('0.150000')
        ->and($this->resolver->withholdingRate($with->id, ($this->day)('2025-01-01')))->toBeNull()
        ->and($this->resolver->withholdingRate($without->id, ($this->day)('2026-03-15')))->toBeNull();
});

it('reads the company rounding mode from its settings', function (): void {
    expect($this->resolver->roundingFor($this->f->companyId))->toBe(TaxRounding::DocumentPerCode);
    DB::table('company_settings')->updateOrInsert(['company_id' => $this->f->companyId], ['tenant_id' => $this->f->tenantId, 'tax_rounding' => 'line']);
    expect($this->resolver->roundingFor($this->f->companyId))->toBe(TaxRounding::Line);
});

it('audits tax changes with the rate that closed the previous one', function (): void {
    $id = newCode($this, 'VAT', 'vat', '0.05');
    $this->codes->addRate($this->f->actor, $id, 0, new TaxRateInput('0.075', ($this->day)('2026-07-01')));
    $event = DB::table('audit_events')->where('action', 'tax_code.rate_added')->first();
    expect($event)->not->toBeNull()
        ->and(json_decode((string) $event->context, true))->toMatchArray(['rate' => '0.075', 'effective_from' => '2026-07-01', 'closed_previous_rate_on' => '2026-06-30']);
});

it('checks the permission inside the Actions, by kind for contacts', function (): void {
    $this->grant('contacts.manage_customers');
    $contacts = app(ManageContact::class);
    $contacts->create($this->f->actor, new ContactInput($this->f->companyId, 'customer', 'C1', 'Customer', 'USD'));
    expect(fn () => $contacts->create($this->f->actor, new ContactInput($this->f->companyId, 'both', 'B1', 'Both', 'USD')))->toThrow(DomainRuleViolation::class, 'contacts.manage')
        ->and(fn () => app(ManageTaxCode::class)->create($this->f->actor, new TaxCodeInput($this->f->companyId, 'X', 'X', 'vat')))->toThrow(DomainRuleViolation::class, 'tax.manage')
        ->and(fn () => app(ManageTaxCode::class)->create($this->f->actorAs(ActorType::ApiClient), new TaxCodeInput($this->f->companyId, 'X', 'X', 'vat')))->toThrow(DomainRuleViolation::class);
});
