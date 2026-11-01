<?php

declare(strict_types=1);

namespace App\Domain\Trade;

use App\Domain\Shared\Fx;

/**
 * Base amounts and exchange difference when credit already on the books is applied to an open document (D9, D4):
 * a settlement's credit on account (carried at the settlement rate) or a credit or debit note (at its own rate)
 * against an invoice or bill carried at its rate. Each side takes its remaining base when this application clears it,
 * so neither control-account balance keeps a stray cent. On the receivables side a gain means the credit is worth more
 * than the document it clears; on payables the document is worth more than the credit.
 */
final readonly class CreditApplicationFx
{
    public function __construct(public int $sourceBase, public int $targetBase, public int $gainLoss) {}

    public static function of(
        bool $onReceivables, int $fc,
        string $sourceRate, int $sourceRemainingFc, int $sourceRemainingBase,
        string $targetRate, int $targetRemainingFc, int $targetRemainingBase,
    ): self {
        $source = $fc >= $sourceRemainingFc ? $sourceRemainingBase : Fx::toBase($fc, $sourceRate, 2, 2);
        $target = $fc >= $targetRemainingFc ? $targetRemainingBase : Fx::toBase($fc, $targetRate, 2, 2);

        return new self($source, $target, $onReceivables ? $source - $target : $target - $source);
    }
}
