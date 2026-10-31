<?php

declare(strict_types=1);

namespace App\Domain\Trade;

use App\Domain\Ledger\JournalType;

/** Depreciation run: Dr expense, Cr accumulated depreciation per asset; non-positive amounts are skipped. */
final class DepreciationPosting
{
    public static function journal(DepreciationInput $run): ProposedJournal
    {
        $dims = ['branch' => 'MG', 'cost_centre' => 'ADMIN'];
        $lines = [];
        foreach ($run->lines as $item) {
            if ($item->amount <= 0) {
                continue;
            }
            $lines[] = new ProposedLine(
                $run->expenseAccountRef, $item->amount, 0, 'USD', '1', $item->amount, $dims,
                "Depreciation: {$item->assetNumber} - {$item->assetName}",
            );
            $lines[] = new ProposedLine(
                $run->accumulatedAccountRef, 0, $item->amount, 'USD', '1', -$item->amount, $dims,
                "Accum. Depr: {$item->assetNumber} - {$item->assetName}",
            );
        }

        return new ProposedJournal(
            JournalType::Depreciation, $run->asOf, "DEPR-{$run->asOf}", "Monthly Fixed Asset Depreciation Run as of {$run->asOf}",
            'depreciation_run', $run->id, $lines,
        );
    }
}
