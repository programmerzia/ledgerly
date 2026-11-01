<?php

declare(strict_types=1);

namespace App\Support\Reports\Export;

/**
 * A report flattened into rows and columns for the exporters. `rows` may be a generator, so a large ledger
 * streams from the database to the file without being held in memory.
 */
final readonly class ReportTable
{
    /**
     * @param  list<array{label: string, numeric: bool}>  $columns
     * @param  iterable<ReportRow>  $rows
     */
    public function __construct(
        public string $title,
        public string $subtitle,
        public array $columns,
        public iterable $rows,
        /** Minor-unit digits of the currency, to turn integer amounts into decimals. */
        public int $decimals,
    ) {}
}
