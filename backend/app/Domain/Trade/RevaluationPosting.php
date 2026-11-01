<?php

declare(strict_types=1);

namespace App\Domain\Trade;

use App\Domain\Ledger\JournalType;

/** Month-end FX revaluation: adjusts each balance-sheet account against unrealised FX. */
final class RevaluationPosting
{
    public static function journal(RevaluationInput $r, PostingAccounts $accounts, string $baseCurrency): ProposedJournal
    {
        $lines = [];
        foreach ($r->items as $item) {
            if ($item->unrealisedGainLoss === 0) {
                continue;
            }
            $isGain = $item->unrealisedGainLoss > 0;
            $diff = abs($item->unrealisedGainLoss);
            $kind = $isGain ? 'Gain' : 'Loss';

            $lines[] = new ProposedLine(
                $item->accountRef, $isGain ? $diff : 0, $isGain ? 0 : $diff, $item->currency, $item->currentRate, $item->amountFc,
                $r->dimensions, "FX Revaluation as of {$r->asOf} ({$item->accountName})",
            );
            $lines[] = new ProposedLine(
                $accounts->fxUnrealised, $isGain ? 0 : $diff, $isGain ? $diff : 0, $baseCurrency, '1', -$item->unrealisedGainLoss,
                $r->dimensions, "Unrealised FX {$kind} on {$item->accountCode}",
            );
        }

        return new ProposedJournal(
            JournalType::Fx, $r->asOf, "REVAL-{$r->asOf}", "Month-end FX Revaluation as of {$r->asOf}", 'fx_revaluation', $r->id, $lines,
        );
    }
}
