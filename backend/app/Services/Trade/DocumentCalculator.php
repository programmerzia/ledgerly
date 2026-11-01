<?php

declare(strict_types=1);

namespace App\Services\Trade;

use App\Actions\Trade\Inputs\InvoiceDraftInput;
use App\Actions\Trade\Inputs\InvoiceLineInput;
use App\Domain\Ledger\PostingValidator;
use App\Domain\Shared\DomainRuleViolation;
use App\Domain\Tax\TaxCalculator;
use App\Domain\Tax\TaxLine;
use App\Domain\Trade\InvoiceKind;
use App\Domain\Trade\LineAmount;
use App\Domain\Trade\PostingSupport;
use App\Models\Organisation\Company;
use App\Models\Tax\TaxCode;
use App\Models\Trade\Contact;
use App\Models\Trade\Item;
use App\Queries\Fx\FindExchangeRate;
use App\Queries\Tax\TaxRateResolver;
use Brick\Math\BigDecimal;
use Brick\Math\RoundingMode;
use Illuminate\Support\Facades\DB;

/**
 * Prices a draft on the server (plan 2.11): line totals, tax per D2 with the company's rounding, the document
 * totals and the base amounts per D1. Client-sent totals do not exist; the client states quantities, prices,
 * discounts and tax codes. Tax is computed in the document currency (D10) and converted once.
 *
 * The line gets, in order: what the client sent, the item's default, the contact's default. Withholding on a
 * supplier document uses the code the client named, else the contact's code. WHT is charged on the net
 * subtotal (before VAT); see the report.
 */
final class DocumentCalculator
{
    public function __construct(private readonly TaxRateResolver $taxRates, private readonly FindExchangeRate $rates) {}

    public function compute(InvoiceDraftInput $in): ComputedDocument
    {
        $company = Company::query()->findOrFail($in->companyId);
        $contact = $this->contact($in);
        $kind = $in->kind;

        $currency = $in->currency ?? $contact->default_currency;
        $fxRate = $this->rate($company, $currency, $in);

        if ($in->lines === []) {
            throw DomainRuleViolation::single('document_lines_missing', 'A document needs at least one line.');
        }

        $items = $this->items($in);
        $this->checkTaxCodes($in, $items, $contact);

        $taxLines = [];
        $priced = [];
        foreach ($in->lines as $i => $line) {
            $lineNo = $i + 1;
            $item = $line->itemId === null ? null : ($items[$line->itemId] ?? null);
            $accountId = $line->accountId
                ?? ($kind->isSales() ? $item?->sales_account_id : $item?->purchase_account_id)
                ?? $contact->default_account_id
                ?? throw DomainRuleViolation::single('line_account_missing', "Line {$lineNo} needs an account (or an item or contact with a default).");
            $unit = $line->unitPriceFc ?? $this->itemPrice($item, $kind, $currency, $lineNo)
                ?? throw DomainRuleViolation::single('line_price_missing', "Line {$lineNo} needs a unit price.");
            $taxCodeId = $line->taxCodeGiven ? $line->taxCodeId : ($item->tax_code_id ?? $contact->default_tax_code_id);

            $net = LineAmount::net($line->quantity, $unit, $line->discountPct);
            if ($net > PostingValidator::MAX_AMOUNT) {
                throw DomainRuleViolation::single('amount_out_of_range', "Line {$lineNo} is larger than the maximum amount.");
            }
            $components = $taxCodeId === null ? [] : [$this->taxRates->component($taxCodeId, $in->issueDate)];
            $taxLines[] = new TaxLine($net, $components);
            $priced[] = [$line, $item, $accountId, $unit, $taxCodeId, $net];
        }

        $result = TaxCalculator::calculate($taxLines, $this->taxRates->roundingFor($in->companyId));

        $lines = [];
        foreach ($priced as $i => [$line, $item, $accountId, $unit, $taxCodeId, $net]) {
            $lineTax = $result->lines[$i];
            $lines[] = new ComputedLine(
                $accountId, $item?->id, $line->description, $line->quantity, $unit, $line->discountPct, $taxCodeId,
                $net, $lineTax->tax, $lineTax->byCode, $line->dims,
            );
        }

        $subtotalFc = $result->net;
        $taxTotalFc = $result->tax;
        $totalFc = $result->gross;
        if ($totalFc > PostingValidator::MAX_AMOUNT) {
            throw DomainRuleViolation::single('amount_out_of_range', 'The document total is larger than the maximum amount.');
        }

        [$whtCodeId, $whtAmountFc] = $this->withholding($in, $contact, $subtotalFc);

        return new ComputedDocument(
            currency: $currency,
            fxRate: $fxRate,
            dueDate: $in->dueDate ?? $in->issueDate->modify("+{$contact->payment_terms_days} days"),
            lines: $lines,
            subtotalFc: $subtotalFc,
            taxTotalFc: $taxTotalFc,
            totalFc: $totalFc,
            // D1: each revenue/expense line, the tax and the control amount are rounded once on their own.
            subtotal: array_sum(array_map(fn (ComputedLine $l): int => PostingSupport::toBase($l->lineTotalFc, $fxRate), $lines)),
            taxTotal: PostingSupport::toBase($taxTotalFc, $fxRate),
            total: PostingSupport::toBase($totalFc, $fxRate),
            whtCodeId: $whtCodeId,
            whtAmountFc: $whtAmountFc,
            whtAmount: $whtAmountFc === 0 ? 0 : PostingSupport::toBase($whtAmountFc, $fxRate),
        );
    }

    private function contact(InvoiceDraftInput $in): Contact
    {
        $contact = Contact::query()->where('company_id', $in->companyId)->find($in->contactId)
            ?? throw DomainRuleViolation::single('not_found', 'The contact does not exist.');
        if (! in_array($contact->kind, $in->kind->contactKinds(), true)) {
            throw DomainRuleViolation::single('contact_kind_invalid', 'A '.$in->kind->label().' needs a '.($in->kind->isSales() ? 'customer' : 'supplier').'.');
        }
        if (! $contact->is_active) {
            throw DomainRuleViolation::single('contact_inactive', 'The contact is inactive.');
        }

        return $contact;
    }

    private function rate(Company $company, string $currency, InvoiceDraftInput $in): string
    {
        $base = $company->base_currency;
        if ($currency === $base) {
            return '1';
        }
        // The posting rules convert with one scale for both sides (docs/fixtures/posting/README.md).
        $units = DB::table('currencies')->whereIn('code', [$currency, $base])->pluck('minor_unit', 'code');
        if (($units[$currency] ?? null) !== ($units[$base] ?? null)) {
            throw DomainRuleViolation::single('currency_scale_unsupported', "{$currency} and {$base} do not have the same minor units; documents in {$currency} are not supported yet.");
        }
        if ($in->fxRate !== null) {
            if (preg_match('/^\d{1,12}(\.\d{1,8})?$/', $in->fxRate) !== 1 || BigDecimal::of($in->fxRate)->isZero()) {
                throw DomainRuleViolation::single('fx_rate_invalid', 'The exchange rate must be a positive decimal.');
            }

            return BigDecimal::of($in->fxRate)->toScale(8, RoundingMode::HalfUp)->__toString();
        }

        return $this->rates->require($company->id, $currency, $base, $in->issueDate->format('Y-m-d'))->rate;
    }

    /** @return array<string, Item> */
    private function items(InvoiceDraftInput $in): array
    {
        $ids = array_values(array_unique(array_filter(array_map(fn (InvoiceLineInput $l) => $l->itemId, $in->lines))));
        if ($ids === []) {
            return [];
        }
        $found = Item::query()->where('company_id', $in->companyId)->whereIn('id', $ids)->get()->keyBy('id');
        foreach ($ids as $id) {
            $item = $found->get($id);
            if ($item === null) {
                throw DomainRuleViolation::single('not_found', 'An item on the document does not exist.');
            }
            if (! $item->is_active) {
                throw DomainRuleViolation::single('item_inactive', "Item {$item->code} is inactive.");
            }
        }

        /** @var array<string, Item> $items */
        $items = $found->all();

        return $items;
    }

    /**
     * Verifies every tax code the lines will use: of this company, active, not a withholding code.
     *
     * @param  array<string, Item>  $items
     */
    private function checkTaxCodes(InvoiceDraftInput $in, array $items, Contact $contact): void
    {
        foreach ($in->lines as $i => $line) {
            $code = $line->taxCodeGiven ? $line->taxCodeId : ($line->itemId !== null ? $items[$line->itemId]->tax_code_id : null) ?? $contact->default_tax_code_id;
            if ($code === null) {
                continue;
            }
            $tax = TaxCode::query()->where('company_id', $in->companyId)->whereKey($code)->first();
            if ($tax === null) {
                throw DomainRuleViolation::single('not_found', 'A tax code on the document does not exist.');
            }
            if (! $tax->is_active || $tax->kind === 'wht') {
                throw DomainRuleViolation::single('tax_code_invalid', 'Line '.($i + 1)." cannot use tax code {$tax->code}.");
            }
        }
    }

    private function itemPrice(?Item $item, InvoiceKind $kind, string $currency, int $lineNo): ?int
    {
        if ($item === null) {
            return null;
        }
        if ($item->currency !== $currency) {
            throw DomainRuleViolation::single('item_currency_mismatch', "Line {$lineNo}: item {$item->code} is priced in {$item->currency}, not {$currency}; state the price.");
        }

        return $kind->isSales() ? $item->sales_price : $item->purchase_price;
    }

    /** @return array{0: string|null, 1: int} the withholding code and its amount in the document currency */
    private function withholding(InvoiceDraftInput $in, Contact $contact, int $subtotalFc): array
    {
        if ($in->kind->isSales()) {
            return [null, 0];
        }
        $codeId = $in->whtCodeGiven ? $in->whtCodeId : $contact->wht_code_id;
        if ($codeId === null) {
            return [null, 0];
        }
        $code = TaxCode::query()->where('company_id', $in->companyId)->whereKey($codeId)->first();
        if ($code === null || ! $code->is_active || $code->kind !== 'wht') {
            throw DomainRuleViolation::single('tax_code_invalid', 'The withholding code must be an active withholding tax code of this company.');
        }
        $rate = $this->taxRates->requireRateOn($codeId, $in->issueDate);

        return [$codeId, BigDecimal::of($subtotalFc)->multipliedBy($rate)->toScale(0, RoundingMode::HalfUp)->toInt()];
    }
}
