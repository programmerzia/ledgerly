<?php

declare(strict_types=1);

namespace App\Domain\Trade;

use App\Domain\Ledger\JournalType;

/**
 * Journal of applying credit to an open document (D9): no cash moves, the control account is cleared on both items
 * and the exchange difference goes to the realised-FX account. Receivables: Dr the credit, Cr the document;
 * payables: Dr the document, Cr the credit.
 */
final class CreditApplicationPosting
{
    /** @param array<string, string> $dimensions */
    public static function journal(
        bool $onReceivables, string $id, string $date, string $controlAccount, string $fxAccount, string $baseCurrency,
        string $contactRef, string $currency, int $fc, string $sourceRate, string $targetRate,
        CreditApplicationFx $fx, string $sourceLabel, string $targetLabel, array $dimensions = [],
    ): ProposedJournal {
        $credit = new ProposedLine(
            $controlAccount, $onReceivables ? $fx->sourceBase : 0, $onReceivables ? 0 : $fx->sourceBase, $currency, $sourceRate,
            $onReceivables ? $fc : -$fc, $dimensions, "Credit {$sourceLabel} applied to {$targetLabel}", $contactRef,
        );
        $document = new ProposedLine(
            $controlAccount, $onReceivables ? 0 : $fx->targetBase, $onReceivables ? $fx->targetBase : 0, $currency, $targetRate,
            $onReceivables ? -$fc : $fc, $dimensions, "Settled by credit {$sourceLabel}: {$targetLabel}", $contactRef,
        );
        $lines = $onReceivables ? [$credit, $document] : [$document, $credit];

        if ($fx->gainLoss !== 0) {
            $gain = $fx->gainLoss > 0;
            $lines[] = new ProposedLine(
                $fxAccount, $gain ? 0 : abs($fx->gainLoss), $gain ? $fx->gainLoss : 0, $baseCurrency, '1', -$fx->gainLoss, $dimensions,
                'Realised FX '.($gain ? 'Gain' : 'Loss')." on {$targetLabel}",
            );
        }

        return new ProposedJournal(
            $onReceivables ? JournalType::Receipt : JournalType::Payment, $date, "{$sourceLabel} / {$targetLabel}",
            "Credit {$sourceLabel} applied to {$targetLabel}", 'credit_application', $id, $lines,
        );
    }
}
