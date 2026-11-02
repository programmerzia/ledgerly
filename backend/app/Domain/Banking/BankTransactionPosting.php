<?php

declare(strict_types=1);

namespace App\Domain\Banking;

use App\Domain\Ledger\DraftLine;
use App\Domain\Shared\DomainRuleViolation;
use App\Domain\Tax\TaxCalculator;
use App\Domain\Tax\TaxComponent;
use App\Domain\Tax\TaxLine;
use App\Domain\Trade\PostingSupport;

/**
 * Journal lines of a bank transaction (14 E1). The statement amount is gross, tax included:
 *   spend:    Dr coding account (net), Dr input tax (tax; with non-recoverable tax the tax joins the expense), Cr bank (gross)
 *   receive:  Dr bank (gross), Cr coding account (net), Cr output tax (tax)
 *   transfer: Dr destination bank, Cr source bank for money out; the reverse for money in (same currency)
 * Tax is split out of the gross with the document rule (D2: rounded once, HALF_UP). Amounts are in the bank's currency;
 * a foreign-currency account books each line once at the rate (D1) and any residue within half a unit per line goes to
 * the rounding account.
 */
final class BankTransactionPosting
{
    /** Account control types a bank line may not be coded to (customer and supplier money goes through documents). Fixed assets are allowed. */
    public const array BLOCKED_CONTROL = ['ar', 'ap', 'tax', 'suspense', 'retained_earnings', 'accum_depr', 'bank', 'cash'];

    /**
     * @param  'spend'|'receive'|'transfer'  $kind
     * @param  array<int, string|null>  $dims
     * @return array{lines: list<DraftLine>, net: int, tax: int}
     */
    public static function build(
        string $kind,
        int $signedAmount,
        string $bankCurrency,
        string $baseCurrency,
        string $rate,
        string $bankGlAccountId,
        ?string $codingAccountId,
        ?string $otherBankGlAccountId,
        ?string $taxCodeId,
        ?string $taxRate,
        ?string $taxAccountId,
        bool $taxRecoverable,
        ?string $roundingAccountId,
        array $dims,
        ?string $contactId,
        string $memo,
        string $bankDescription,
        string $otherName = '',
    ): array {
        $gross = abs($signedAmount);
        if ($gross === 0) {
            throw DomainRuleViolation::single('amount_zero', 'The bank line has no amount.');
        }
        $out = $signedAmount < 0;
        if ($kind === 'spend' && ! $out) {
            throw DomainRuleViolation::single('direction_mismatch', 'Money in cannot be recorded as spend money.');
        }
        if ($kind === 'receive' && $out) {
            throw DomainRuleViolation::single('direction_mismatch', 'Money out cannot be recorded as receive money.');
        }
        $foreign = $bankCurrency !== $baseCurrency;

        $net = $gross;
        $tax = 0;
        if ($kind !== 'transfer' && $taxCodeId !== null && $taxRate !== null) {
            $res = TaxCalculator::calculate([new TaxLine($gross, [new TaxComponent($taxCodeId, $taxRate)], inclusive: true)]);
            $net = $res->net;
            $tax = $res->tax;
        }
        if ($tax > 0 && $taxAccountId === null && ($kind === 'receive' || $taxRecoverable)) {
            throw DomainRuleViolation::single('tax_account_missing', 'This tax code has no account for this direction.');
        }

        // [account, signed fc amount (+ debit), description, dims, contact]
        $spec = [];
        if ($kind === 'transfer') {
            $spec[] = [$otherBankGlAccountId, $out ? $gross : -$gross, $out ? "Transfer to {$otherName}" : "Transfer from {$otherName}", [], null];
            $spec[] = [$bankGlAccountId, $out ? -$gross : $gross, $memo, [], null];
        } else {
            $s = $kind === 'spend' ? 1 : -1;
            $mergeTax = $kind === 'spend' && ! $taxRecoverable && $tax > 0;
            $spec[] = [$codingAccountId, $s * ($mergeTax ? $net + $tax : $net), $memo, $dims, $contactId];
            if ($tax > 0 && ! $mergeTax) {
                $spec[] = [$taxAccountId, $s * $tax, 'Tax on '.$memo, [], null];
            }
            $spec[] = [$bankGlAccountId, -$s * $gross, $bankDescription, [], null];
        }

        $lines = [];
        foreach ($spec as [$account, $fc, $desc, $d, $contact]) {
            $base = $foreign ? PostingSupport::toBase(abs($fc), $rate) : abs($fc);
            $lines[] = new DraftLine(
                (string) $account, $fc > 0 ? $base : 0, $fc < 0 ? $base : 0,
                $foreign ? $bankCurrency : null, $foreign ? $rate : null, $foreign ? $fc : null,
                $d, $desc, $contact, null,
            );
        }
        if ($foreign) {
            $diff = array_sum(array_map(fn (DraftLine $l): int => $l->debit - $l->credit, $lines));
            if ($diff !== 0) {
                if (abs($diff) * 2 > count($lines) || $roundingAccountId === null) {
                    throw DomainRuleViolation::single('rounding_residue_too_large', 'The difference is larger than currency rounding can explain, or no rounding account is set.');
                }
                $lines[] = new DraftLine($roundingAccountId, $diff < 0 ? -$diff : 0, $diff > 0 ? $diff : 0, $baseCurrency, null, null, [], 'Rounding');
            }
        }

        return ['lines' => $lines, 'net' => $net, 'tax' => $tax];
    }
}
