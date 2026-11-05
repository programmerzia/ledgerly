<?php

declare(strict_types=1);

namespace App\Queries\FixedAssets;

final readonly class AssetPreviewJournalLine
{
    public function __construct(public string $accountCode, public string $accountName, public int $debit, public int $credit) {}
}
