<?php

declare(strict_types=1);

namespace App\Support\Reports\Export;

/**
 * One line of an exported report. Cells are text, a money array (`{amount, currency}`, minor units), or null.
 * `style` is normal, heading (a section title), total or grand_total.
 */
final readonly class ReportRow
{
    /** @param list<string|int|array{amount: int, currency: string}|null> $cells */
    public function __construct(public array $cells, public string $style = 'normal') {}
}
