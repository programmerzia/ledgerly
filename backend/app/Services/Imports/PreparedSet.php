<?php

declare(strict_types=1);

namespace App\Services\Imports;

/** The verdict on a whole import: one outcome per row number, and errors about the file as a whole (an unbalanced trial balance). */
final class PreparedSet
{
    /**
     * @param  array<int, RowOutcome>  $rows
     * @param  list<array{code: string, message: string, row_number?: int}>  $fileErrors
     * @param  array<string, mixed>  $summary  figures to show next to the preview (totals)
     */
    public function __construct(public array $rows = [], public array $fileErrors = [], public array $summary = []) {}
}
