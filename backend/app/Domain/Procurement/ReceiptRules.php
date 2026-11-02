<?php

declare(strict_types=1);

namespace App\Domain\Procurement;

use App\Domain\Shared\Violation;
use Brick\Math\BigDecimal;

/** What a receipt may do to an order line's received quantity. Pure. */
final class ReceiptRules
{
    /** Received, with this receipt, may exceed the ordered quantity by at most the tolerance. */
    public static function overReceipt(LineFigures $line, string $receivedNow, string $tolerancePct, int $lineNo): ?Violation
    {
        $after = Quantity::add($line->received, $receivedNow);
        if (BigDecimal::of($after)->isGreaterThan(Quantity::withTolerance($line->ordered, $tolerancePct))) {
            return new Violation('receipt_quantity_exceeds_open', "Line {$lineNo}: this is more than is still open on the order.", $lineNo);
        }

        return null;
    }

    /** Reversing must leave at least what was billed, or a bill would stand with nothing behind it. */
    public static function reversal(LineFigures $line, string $reversed, int $lineNo): ?Violation
    {
        $after = Quantity::remaining($line->received, $reversed);
        if (Quantity::exceeds($line->billed, $after)) {
            return new Violation('receipt_already_billed', "Line {$lineNo}: this quantity is already on a bill; reverse the bill first.", $lineNo);
        }

        return null;
    }
}
