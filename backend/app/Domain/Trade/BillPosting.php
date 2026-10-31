<?php

declare(strict_types=1);

namespace App\Domain\Trade;

use App\Domain\Ledger\JournalType;

/** Purchase bill to journal: Cr AP net of WHT, Cr WHT payable, Dr expense per line, Dr input tax, residue to rounding. */
final class BillPosting
{
    public static function journal(BillDocument $bill, PostingAccounts $accounts): ProposedJournal
    {
        $number = PostingSupport::orDefault($bill->number, 'Bill');
        $firstDims = $bill->lines[0]->dimensions ?? [];
        $rate = $bill->fxRate;
        $cur = $bill->currency;

        $whtBase = $bill->whtAmountFc !== 0 ? PostingSupport::toBase($bill->whtAmountFc, $rate) : 0;
        $netAp = PostingSupport::toBase($bill->totalFc, $rate) - $whtBase;

        $lines = [new ProposedLine(
            $accounts->apControl, 0, $netAp, $cur, $rate, -($bill->totalFc - $bill->whtAmountFc),
            $firstDims, "AP Control: {$number} - {$bill->reference}", $bill->contactRef,
        )];

        if ($whtBase > 0) {
            $lines[] = new ProposedLine(
                $accounts->whtPayable, 0, $whtBase, $cur, $rate, -$bill->whtAmountFc,
                $firstDims, "WHT Withheld on Bill: {$number}", $bill->contactRef,
            );
        }

        foreach ($bill->lines as $l) {
            $lines[] = new ProposedLine(
                $l->accountRef, PostingSupport::toBase($l->lineTotalFc, $rate), 0, $cur, $rate, $l->lineTotalFc,
                $l->dimensions, PostingSupport::orDefault($l->description, "Expense: {$number}"), $bill->contactRef, $l->taxCodeRef,
            );
        }

        $taxFc = $bill->taxTotalFc !== 0 ? $bill->taxTotalFc : $bill->taxTotal;
        if ($taxFc > 0) {
            $lines[] = new ProposedLine(
                $accounts->taxInput, PostingSupport::toBase($taxFc, $rate), 0, $cur, $rate, $taxFc,
                $firstDims, "Input VAT Recoverable: {$number}", $bill->contactRef,
            );
        }

        $residue = PostingSupport::residue($lines, $accounts->rounding, $cur, $rate, $firstDims, "FX Rounding adjustment: {$number}");
        if ($residue !== null) {
            $lines[] = $residue;
        }

        return new ProposedJournal(
            JournalType::Purchase, $bill->issueDate, PostingSupport::orDefault($bill->number, $bill->reference),
            'Purchase bill '.PostingSupport::orDefault($bill->number, 'Draft').': '.($bill->memo ?? ''),
            'purchase_bill', $bill->id, $lines,
        );
    }
}
