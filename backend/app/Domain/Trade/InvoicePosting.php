<?php

declare(strict_types=1);

namespace App\Domain\Trade;

use App\Domain\Ledger\JournalType;

/** Sales invoice to journal: Dr AR, Cr revenue per line, Cr output tax, residue to rounding (13 §9, D1, D2). */
final class InvoicePosting
{
    public static function journal(InvoiceDocument $invoice, PostingAccounts $accounts): ProposedJournal
    {
        $number = PostingSupport::orDefault($invoice->number, 'Invoice');
        $firstDims = $invoice->lines[0]->dimensions ?? [];
        $rate = $invoice->fxRate;
        $cur = $invoice->currency;

        $lines = [new ProposedLine(
            $accounts->arControl, PostingSupport::toBase($invoice->totalFc, $rate), 0, $cur, $rate, $invoice->totalFc,
            $firstDims, "AR Control: {$number} - Contact Ref #{$invoice->reference}", $invoice->contactRef,
        )];

        foreach ($invoice->lines as $l) {
            $lines[] = new ProposedLine(
                $l->accountRef, 0, PostingSupport::toBase($l->lineTotalFc, $rate), $cur, $rate, -$l->lineTotalFc,
                $l->dimensions, PostingSupport::orDefault($l->description, "Revenue: {$number}"), $invoice->contactRef, $l->taxCodeRef,
            );
        }

        $taxFc = PostingSupport::documentTaxFc($invoice->taxTotalFc, $invoice->taxTotal, $rate);
        if ($taxFc > 0) {
            $lines[] = new ProposedLine(
                $accounts->taxOutput, 0, PostingSupport::toBase($taxFc, $rate), $cur, $rate, -$taxFc,
                $firstDims, "Sales Tax Output: {$number}", $invoice->contactRef,
            );
        }

        $residue = PostingSupport::residue($lines, $accounts->rounding, $cur, $rate, $firstDims, "FX Rounding adjustment: {$number}");
        if ($residue !== null) {
            $lines[] = $residue;
        }

        return new ProposedJournal(
            JournalType::Sales, $invoice->issueDate, PostingSupport::orDefault($invoice->number, $invoice->reference),
            'Sales invoice '.PostingSupport::orDefault($invoice->number, 'Draft').': '.($invoice->memo ?? ''),
            'sales_invoice', $invoice->id, $lines,
        );
    }
}
