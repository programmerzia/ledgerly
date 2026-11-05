<?php

declare(strict_types=1);

namespace App\Domain\Ledger;

use App\Domain\Trade\InvoiceKind;

/** Which posted journals may be reversed on their own. */
final class JournalReversal
{
    /** An invoice's or bill's journal is undone through the document, which keeps the sub-ledger and the ledger in step. */
    public static function belongsToDocument(?string $sourceType): bool
    {
        return in_array($sourceType, [...InvoiceKind::values(...InvoiceKind::cases()), 'settlement', 'credit_application', 'depreciation_run', 'asset_disposal', 'asset_impairment', 'asset_revaluation'], true);
    }
}
