<?php

declare(strict_types=1);

namespace App\Domain\Trade;

/** The company's posting_accounts setting; values are opaque account references. */
final readonly class PostingAccounts
{
    public function __construct(
        public string $arControl,
        public string $apControl,
        public string $taxOutput,
        public string $taxInput,
        public string $fxRealised,
        public string $fxUnrealised,
        public string $rounding,
        public string $whtPayable,
    ) {}
}
