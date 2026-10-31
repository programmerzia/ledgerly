<?php

declare(strict_types=1);

namespace App\Domain\Trade;

use App\Domain\Ledger\JournalType;

/** Month-end FX revaluation: adjusts each balance-sheet account against unrealised FX (hard-coded 'USD' and dimensions as in the mock). */
final class RevaluationPosting
{
    public static function journal(RevaluationInput $r, PostingAccounts $accounts): ProposedJournal
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
                ['branch' => 'MG'], "FX Revaluation as of {$r->asOf} ({$item->accountName})",
            );
            $lines[] = new ProposedLine(
                $accounts->fxUnrealised, $isGain ? 0 : $diff, $isGain ? $diff : 0, 'USD', '1', $item->unrealisedGainLoss,
                ['branch' => 'MG', 'cost_centre' => 'FIN'], "Unrealised FX {$kind} on {$item->accountCode}",
            );
        }

        return new ProposedJournal(
            JournalType::Fx, $r->asOf, "REVAL-{$r->asOf}", "Month-end FX Revaluation as of {$r->asOf}", 'fx_revaluation', $r->id, $lines,
        );
    }
}
