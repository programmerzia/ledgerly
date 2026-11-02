<?php

declare(strict_types=1);

use App\Domain\Imports\CellSanitizer;

it('prefixes text a spreadsheet would run as a formula, and leaves numbers and ordinary text alone', function (string $cell, string $shown): void {
    expect(CellSanitizer::forOutput($cell))->toBe($shown);
})->with([
    ['=1+1', "'=1+1"],
    ['+cmd|\' /C calc\'!A0', "'+cmd|' /C calc'!A0"],
    ['-2+3', "'-2+3"],
    ['@SUM(A1)', "'@SUM(A1)"],
    ["\t=1", "'\t=1"],
    ['-12.50', '-12.50'],
    ['+1,234.50', '+1,234.50'],
    ['1234', '1234'],
    ['Acme Ltd', 'Acme Ltd'],
    ['', ''],
]);

it('sanitises both the header and the cell of a row', function (): void {
    expect(CellSanitizer::row(['=A1' => '=B1', 'Name' => 'Ann']))->toBe(["'=A1" => "'=B1", 'Name' => 'Ann']);
});
