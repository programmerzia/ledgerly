<?php

declare(strict_types=1);

namespace App\Domain\Trade;

/** A sales invoice ready to post. Tax totals are computed upstream (per document, per tax code: D2). */
final readonly class InvoiceDocument
{
    /** @param  list<DocumentLine>  $lines */
    public function __construct(
        public string $id,
        public ?string $number,
        public string $reference,
        public ?string $memo,
        public string $contactRef,
        public string $issueDate,
        public string $currency,
        public string $fxRate,
        public array $lines,
        public int $taxTotalFc,
        public int $taxTotal,
        public int $totalFc,
    ) {}
}
