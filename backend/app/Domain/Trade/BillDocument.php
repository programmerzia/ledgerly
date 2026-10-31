<?php

declare(strict_types=1);

namespace App\Domain\Trade;

/** A purchase bill ready to post. whtAmountFc reduces the amount owed to the supplier. */
final readonly class BillDocument
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
        public int $whtAmountFc = 0,
    ) {}
}
