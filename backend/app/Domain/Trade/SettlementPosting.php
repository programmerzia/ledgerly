<?php

declare(strict_types=1);

namespace App\Domain\Trade;

use App\Domain\Ledger\JournalType;

/**
 * Receipt/payment to journal (D4). The mock hard-codes dimension branch 'MG', and base currency 'USD' on
 * the realised FX line; both are reproduced verbatim for parity and flagged for a human decision.
 */
final class SettlementPosting
{
    private const BRANCH = ['branch' => 'MG'];

    private const FX_DIMS = ['branch' => 'MG', 'cost_centre' => 'FIN'];

    public static function journal(SettlementDocument $s, PostingAccounts $accounts): ProposedJournal
    {
        $isReceipt = $s->isReceipt();
        $control = $isReceipt ? $accounts->arControl : $accounts->apControl;
        $rate = $s->fxRate;
        $cur = $s->currency;

        $lines = [new ProposedLine(
            $s->bankAccountRef, $isReceipt ? $s->amount : 0, $isReceipt ? 0 : $s->amount, $cur, $rate,
            $isReceipt ? $s->amountFc : -$s->amountFc, self::BRANCH,
            ($isReceipt ? 'Receipt' : 'Payment')." {$s->number} - Ref: {$s->reference}", $s->contactRef,
        )];

        foreach ($s->allocations as $a) {
            $lines[] = new ProposedLine(
                $control, $isReceipt ? 0 : $a->allocatedAmountBase, $isReceipt ? $a->allocatedAmountBase : 0, $cur, $rate,
                $isReceipt ? -$a->allocatedAmountFc : $a->allocatedAmountFc, self::BRANCH,
                "Settlement for {$a->invoiceNumber}", $s->contactRef,
            );

            if ($a->fxGainLoss !== 0) {
                $isGain = $a->fxGainLoss > 0;
                $lines[] = new ProposedLine(
                    $accounts->fxRealised, $isGain ? 0 : abs($a->fxGainLoss), $isGain ? $a->fxGainLoss : 0, 'USD', '1',
                    $a->fxGainLoss, self::FX_DIMS, 'Realised FX '.($isGain ? 'Gain' : 'Loss')." on {$a->invoiceNumber}",
                );
            }
        }

        $residue = PostingSupport::residue($lines, $accounts->rounding, $cur, $rate, self::BRANCH, 'Settlement rounding adjustment');
        if ($residue !== null) {
            $lines[] = $residue;
        }

        return new ProposedJournal(
            $isReceipt ? JournalType::Receipt : JournalType::Payment, $s->settlementDate, $s->number,
            PostingSupport::orDefault($s->memo, ($isReceipt ? 'Customer Receipt' : 'Supplier Payment')." {$s->number}"),
            'settlement', $s->id, $lines,
        );
    }
}
