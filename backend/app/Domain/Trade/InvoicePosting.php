<?php

declare(strict_types=1);

namespace App\Domain\Trade;

use App\Domain\Ledger\JournalType;

/**
 * Sales invoice to journal: Dr AR, Cr revenue per line, Cr output tax, residue to rounding (13 §9, D1, D2).
 * A credit note is its mirror: Cr AR, Dr revenue per line, Dr output tax (IFRS 15: the revenue and the tax are
 * reversed; the receivable falls, or becomes a credit to apply against another invoice or refund).
 */
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

    public static function creditNote(InvoiceDocument $note, PostingAccounts $accounts): ProposedJournal
    {
        $number = PostingSupport::orDefault($note->number, 'Credit note');
        $firstDims = $note->lines[0]->dimensions ?? [];
        $rate = $note->fxRate;
        $cur = $note->currency;

        $lines = [new ProposedLine(
            $accounts->arControl, 0, PostingSupport::toBase($note->totalFc, $rate), $cur, $rate, -$note->totalFc,
            $firstDims, "AR Control: {$number} - Contact Ref #{$note->reference}", $note->contactRef,
        )];

        foreach ($note->lines as $l) {
            $lines[] = new ProposedLine(
                $l->accountRef, PostingSupport::toBase($l->lineTotalFc, $rate), 0, $cur, $rate, $l->lineTotalFc,
                $l->dimensions, PostingSupport::orDefault($l->description, "Sales credit: {$number}"), $note->contactRef, $l->taxCodeRef,
            );
        }

        $taxFc = PostingSupport::documentTaxFc($note->taxTotalFc, $note->taxTotal, $rate);
        if ($taxFc > 0) {
            $lines[] = new ProposedLine(
                $accounts->taxOutput, PostingSupport::toBase($taxFc, $rate), 0, $cur, $rate, $taxFc,
                $firstDims, "Sales Tax Output reversed: {$number}", $note->contactRef,
            );
        }

        $residue = PostingSupport::residue($lines, $accounts->rounding, $cur, $rate, $firstDims, "FX Rounding adjustment: {$number}");
        if ($residue !== null) {
            $lines[] = $residue;
        }

        return new ProposedJournal(
            JournalType::Sales, $note->issueDate, PostingSupport::orDefault($note->number, $note->reference),
            'Credit note '.PostingSupport::orDefault($note->number, 'Draft').': '.($note->memo ?? ''),
            'credit_note', $note->id, $lines,
        );
    }
}
