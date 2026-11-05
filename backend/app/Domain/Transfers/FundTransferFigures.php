<?php

declare(strict_types=1);

namespace App\Domain\Transfers;

/** Everything the posting rule needs about one transfer: account references, names for descriptions, and the figures. */
final readonly class FundTransferFigures
{
    public function __construct(
        public string $id,
        public string $number,
        public ?string $memo,
        public string $sendDate,
        public string $fromAccountRef,
        public string $toAccountRef,
        public string $fromName,
        public string $toName,
        public string $fromCurrency,
        public int $fromAmountFc,
        public string $sendRate,
        public int $feeFc,
        public ?string $feeAccountRef,
        public string $toCurrency,
        public int $toAmountFc,
        public string $receiveRate,
        public string $inTransitRef,
        public string $fxGainRef,
        public string $fxLossRef,
    ) {}
}
