<?php

declare(strict_types=1);

namespace App\Services\Trade;

use DateTimeImmutable;

/** Everything the server derives for a draft: currency, rate, due date, lines and every total (D1, D2, D10). */
final readonly class ComputedDocument
{
    /** @param list<ComputedLine> $lines */
    public function __construct(
        public string $currency,
        public string $fxRate,
        public DateTimeImmutable $dueDate,
        public array $lines,
        public int $subtotalFc,
        public int $taxTotalFc,
        public int $totalFc,
        public int $subtotal,
        public int $taxTotal,
        public int $total,
        public ?string $whtCodeId,
        public int $whtAmountFc,
        public int $whtAmount,
    ) {}
}
