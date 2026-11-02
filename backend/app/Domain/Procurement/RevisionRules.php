<?php

declare(strict_types=1);

namespace App\Domain\Procurement;

use App\Domain\Shared\Violation;

/**
 * What a revision may change on an order that is already in use. A line with receipts or bills keeps its item and cannot go
 * below what was received or billed, and it cannot be removed. Price, tax, account and dimensions may change: that is
 * what a revision is for, and the next bill is matched against the new price.
 */
final class RevisionRules
{
    /**
     * @param  list<RevisionLine>  $proposed
     * @param  array<string, array{figures: LineFigures, item_id: string|null, linked: bool}>  $existing  order line id → what stands; `linked`: any receipt or bill line refers to it, drafts and reversed ones too
     * @return list<Violation>
     */
    public static function check(array $proposed, array $existing): array
    {
        $violations = [];
        $kept = [];
        foreach ($proposed as $line) {
            if ($line->id === null) {
                continue;
            }
            $stands = $existing[$line->id] ?? null;
            if ($stands === null) {
                $violations[] = new Violation('revision_line_unknown', "Line {$line->lineNo} is not on this order.", $line->lineNo);

                continue;
            }
            $kept[$line->id] = true;
            if ($stands['linked'] && $line->itemId !== $stands['item_id']) {
                $violations[] = new Violation('revision_item_fixed', "Line {$line->lineNo} has receipts or bills, so its item cannot change.", $line->lineNo);
            }
            $figures = $stands['figures'];
            if (Quantity::exceeds($figures->received, $line->quantity) || Quantity::exceeds($figures->billed, $line->quantity)) {
                $violations[] = new Violation('revision_quantity_below_used', "Line {$line->lineNo} cannot go below what was received or billed.", $line->lineNo);
            }
        }
        foreach ($existing as $id => $stands) {
            if (! isset($kept[$id]) && $stands['linked']) {
                $violations[] = new Violation('revision_line_in_use', 'A line with receipts or bills cannot be removed.');
            }
        }

        return $violations;
    }
}
