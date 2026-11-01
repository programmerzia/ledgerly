<?php

declare(strict_types=1);

namespace App\Domain\Trade;

use App\Domain\Shared\Fx;

/**
 * Realised FX per allocation (D4, IAS 21). Carried base = round(alloc_fc × document rate), except the
 * allocation that fully settles the document, which takes the remaining base, so the control account
 * never keeps a residual cent. A gain means more cash came in, or less went out, than was carried.
 */
final readonly class RealisedFx
{
    public function __construct(public int $carriedBase, public int $gainLoss) {}

    public static function of(
        bool $cashIn, int $allocatedFc, string $settlementRate, string $documentRate,
        int $documentTotalFc, int $documentTotalBase, int $settledFc, int $settledBase,
    ): self {
        $carried = $settledFc + $allocatedFc >= $documentTotalFc
            ? $documentTotalBase - $settledBase
            : Fx::toBase($allocatedFc, $documentRate, 2, 2);
        $settled = Fx::toBase($allocatedFc, $settlementRate, 2, 2);

        return new self($carried, $cashIn ? $settled - $carried : $carried - $settled);
    }
}
