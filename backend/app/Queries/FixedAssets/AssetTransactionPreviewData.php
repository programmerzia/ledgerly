<?php

declare(strict_types=1);

namespace App\Queries\FixedAssets;

/** The preview of a disposal, impairment, reversal or revaluation: per asset, its figures and the journal lines it would post. */
final readonly class AssetTransactionPreviewData
{
    /** @param list<AssetPreviewLine> $assets */
    public function __construct(public string $kind, public string $txDate, public int $total, public array $assets) {}
}
