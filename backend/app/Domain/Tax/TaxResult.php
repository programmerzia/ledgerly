<?php

declare(strict_types=1);

namespace App\Domain\Tax;

/** The tax of a document. Line taxes always add up to the document's tax per code. */
final readonly class TaxResult
{
    /**
     * @param  list<LineTax>  $lines  in the order of the input lines
     * @param  array<string, int>  $byCode  tax code id → tax for the document
     */
    public function __construct(public array $lines, public array $byCode, public int $net, public int $tax, public int $gross) {}
}
