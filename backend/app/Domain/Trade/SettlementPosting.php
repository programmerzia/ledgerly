<?php

declare(strict_types=1);

namespace App\Domain\Trade;

use App\Domain\Ledger\JournalType;
use App\Domain\Shared\DomainRuleViolation;

/**
 * Settlement to journal (D4, D9, D11). Cash direction and control account follow the kind, so a customer
 * refund debits AR and a supplier refund credits AP. Any unallocated part stays on the control account
 * with the contact, at the settlement rate.
 */
final class SettlementPosting
{
    public static function journal(SettlementDocument $s, PostingAccounts $accounts, string $baseCurrency): ProposedJournal
    {
        $cashIn = $s->isCashIn();
        $control = $s->isOnReceivables() ? $accounts->arControl : $accounts->apControl;
        $rate = $s->fxRate;
        $cur = $s->currency;
        $dims = $s->dimensions;

        $lines = [new ProposedLine(
            $s->bankAccountRef, $cashIn ? $s->amount : 0, $cashIn ? 0 : $s->amount, $cur, $rate,
            $cashIn ? $s->amountFc : -$s->amountFc, $dims,
            "{$s->label()} {$s->number} - Ref: {$s->reference}", $s->contactRef,
        )];

        $allocatedFc = 0;
        foreach ($s->allocations as $a) {
            $allocatedFc += $a->allocatedAmountFc;
            $lines[] = new ProposedLine(
                $control, $cashIn ? 0 : $a->allocatedAmountBase, $cashIn ? $a->allocatedAmountBase : 0, $cur, $a->invoiceFxRate ?? $rate,
                $cashIn ? -$a->allocatedAmountFc : $a->allocatedAmountFc, $dims,
                "Settlement for {$a->invoiceNumber}", $s->contactRef,
            );

            if ($a->fxGainLoss !== 0) {
                $isGain = $a->fxGainLoss > 0;
                $lines[] = new ProposedLine(
                    $isGain || $accounts->fxRealisedLoss === '' ? $accounts->fxRealised : $accounts->fxRealisedLoss, $isGain ? 0 : abs($a->fxGainLoss), $isGain ? $a->fxGainLoss : 0, $baseCurrency, '1',
                    -$a->fxGainLoss, $dims, 'Realised FX '.($isGain ? 'Gain' : 'Loss')." on {$a->invoiceNumber}",
                );
            }
        }

        $unallocatedFc = $s->amountFc - $allocatedFc;
        if ($unallocatedFc < 0) {
            throw DomainRuleViolation::single('allocation_exceeds_settlement', 'The allocations exceed the settlement amount.');
        }
        if ($unallocatedFc > 0) {
            $base = PostingSupport::toBase($unallocatedFc, $rate);
            $lines[] = new ProposedLine(
                $control, $cashIn ? 0 : $base, $cashIn ? $base : 0, $cur, $rate, $cashIn ? -$unallocatedFc : $unallocatedFc, $dims,
                "On account: {$s->number}", $s->contactRef,
            );
        }

        $residue = PostingSupport::residue($lines, $accounts->rounding, $cur, $rate, $dims, 'Settlement rounding adjustment');
        if ($residue !== null) {
            $lines[] = $residue;
        }

        $default = match ($s->kind) {
            'receipt' => 'Customer Receipt',
            'payment' => 'Supplier Payment',
            default => $s->label(),
        };

        return new ProposedJournal(
            $cashIn ? JournalType::Receipt : JournalType::Payment, $s->settlementDate, $s->number,
            PostingSupport::orDefault($s->memo, "{$default} {$s->number}"),
            'settlement', $s->id, $lines,
        );
    }
}
