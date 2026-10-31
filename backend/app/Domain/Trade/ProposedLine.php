<?php

declare(strict_types=1);

namespace App\Domain\Trade;

/** One line of a proposed journal. Money in integer minor units; the rate is an exact decimal string. */
final readonly class ProposedLine
{
    /** @param  array<string, string>  $dimensions */
    public function __construct(
        public string $accountRef,
        public int $debit,
        public int $credit,
        public string $currency,
        public string $fxRate,
        public int $amountFc,
        public array $dimensions,
        public string $description,
        public ?string $contactRef = null,
        public ?string $taxCodeRef = null,
    ) {}
}
