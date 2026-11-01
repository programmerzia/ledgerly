<?php

declare(strict_types=1);

namespace App\Queries\Tax;

use App\Domain\Shared\DomainRuleViolation;
use App\Domain\Tax\TaxComponent;
use App\Domain\Tax\TaxRatePeriod;
use App\Domain\Tax\TaxRates;
use App\Domain\Tax\TaxRounding;
use App\Models\Tax\TaxGroup;
use App\Models\Tax\TaxRate;
use App\Models\Trade\Contact;
use DateTimeImmutable;
use Illuminate\Support\Facades\DB;

/**
 * What the tax engine needs from the database: the rate of a code on a date, a group's components in sequence,
 * a contact's withholding rate, and the company's rounding mode. Rates are fractions as strings ("0.050000").
 */
final class TaxRateResolver
{
    /** The rate in force on $date, or null when the code has none that day. */
    public function rateOn(string $taxCodeId, DateTimeImmutable $date): ?string
    {
        return TaxRates::on($this->periods($taxCodeId), $date);
    }

    /** @throws DomainRuleViolation `tax_rate_missing` when the code has no rate on $date */
    public function requireRateOn(string $taxCodeId, DateTimeImmutable $date): string
    {
        return $this->rateOn($taxCodeId, $date) ?? throw DomainRuleViolation::single('tax_rate_missing', 'The tax code has no rate on '.$date->format('Y-m-d').'.');
    }

    /** One tax code as a component of a line. */
    public function component(string $taxCodeId, DateTimeImmutable $date): TaxComponent
    {
        return new TaxComponent($taxCodeId, $this->requireRateOn($taxCodeId, $date));
    }

    /**
     * A group's components in sequence, at the rates in force on $date.
     *
     * @return list<TaxComponent>
     */
    public function groupComponents(string $taxGroupId, DateTimeImmutable $date): array
    {
        $group = TaxGroup::query()->with('items')->findOrFail($taxGroupId);

        return array_values($group->items->map(fn ($item): TaxComponent => new TaxComponent(
            $item->tax_code_id, $this->requireRateOn($item->tax_code_id, $date), $item->compound,
        ))->all());
    }

    /** The withholding rate of a contact on $date: its withholding code's rate, or null when it has no code or the code has no rate then. */
    public function withholdingRate(string $contactId, DateTimeImmutable $date): ?string
    {
        $codeId = Contact::query()->whereKey($contactId)->value('wht_code_id');

        return is_string($codeId) ? $this->rateOn($codeId, $date) : null;
    }

    public function roundingFor(string $companyId): TaxRounding
    {
        $mode = DB::table('company_settings')->where('company_id', $companyId)->value('tax_rounding');

        return TaxRounding::tryFrom(is_string($mode) ? $mode : '') ?? TaxRounding::DocumentPerCode;
    }

    /** @return list<TaxRatePeriod> */
    private function periods(string $taxCodeId): array
    {
        return array_values(TaxRate::query()->where('tax_code_id', $taxCodeId)->orderBy('effective_from')->get()
            ->map(fn (TaxRate $r): TaxRatePeriod => new TaxRatePeriod($r->rate, $r->effective_from->toDateTimeImmutable(), $r->effective_to?->toDateTimeImmutable()))
            ->all());
    }
}
