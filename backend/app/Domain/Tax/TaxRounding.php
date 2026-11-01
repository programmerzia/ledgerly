<?php

declare(strict_types=1);

namespace App\Domain\Tax;

/** `company_settings.tax_rounding` (23 D2). */
enum TaxRounding: string
{
    /** Per document and per tax code: unrounded line taxes are summed, rounded once, and allocated back by largest remainder. */
    case DocumentPerCode = 'document_per_code';

    /** Each line's tax per code is rounded on its own. */
    case Line = 'line';
}
