<?php

declare(strict_types=1);

namespace App\Domain\Imports;

/**
 * Cells are echoed back to people who may open the response in a spreadsheet. A text cell that starts with = + - @ (or a tab or
 * carriage return) would run as a formula there, so it is shown with a leading apostrophe. Plain numbers are left alone. Stored
 * cells stay exactly as uploaded: natural keys must match byte for byte, and the importing Actions validate them.
 */
final class CellSanitizer
{
    public static function forOutput(?string $cell): ?string
    {
        if ($cell === null || $cell === '') {
            return $cell;
        }
        if (! in_array($cell[0], ['=', '+', '-', '@', "\t", "\r"], true)) {
            return $cell;
        }
        if (preg_match('/^[+-]?(\d+([.,]\d+)*|[.,]\d+)$/', $cell) === 1) {
            return $cell;
        }

        return "'".$cell;
    }

    /**
     * @param  array<string, string|null>  $cells
     * @return array<string, string|null>
     */
    public static function row(array $cells): array
    {
        $out = [];
        foreach ($cells as $header => $cell) {
            $out[(string) self::forOutput((string) $header)] = self::forOutput($cell);
        }

        return $out;
    }
}
