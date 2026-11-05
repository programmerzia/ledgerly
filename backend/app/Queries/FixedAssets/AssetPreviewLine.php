<?php

declare(strict_types=1);

namespace App\Queries\FixedAssets;

/**
 * One asset in a preview. Figures that do not apply to the kind are null: `gainOrLoss` (disposal, positive is a gain),
 * `toReserve` and `toProfitOrLoss` (revaluation and impairment of a revalued asset), `cap` (impairment reversal).
 */
final readonly class AssetPreviewLine
{
    /** @param list<AssetPreviewJournalLine> $journalLines */
    public function __construct(
        public string $assetId,
        public string $assetNumber,
        public string $assetName,
        public int $carryingBefore,
        public int $carryingAfter,
        public ?int $gainOrLoss,
        public ?int $toReserve,
        public ?int $toProfitOrLoss,
        public ?int $cap,
        public array $journalLines,
    ) {}
}
