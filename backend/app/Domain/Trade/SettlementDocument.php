<?php

declare(strict_types=1);

namespace App\Domain\Trade;

/** A receipt, payment or refund. Any kind other than 'receipt' posts as a payment (as the mock does). */
final readonly class SettlementDocument
{
    /** @param  list<SettlementAllocation>  $allocations */
    public function __construct(
        public string $id,
        public string $kind,
        public string $number,
        public string $reference,
        public ?string $memo,
        public string $contactRef,
        public string $bankAccountRef,
        public string $settlementDate,
        public string $currency,
        public string $fxRate,
        public int $amountFc,
        public int $amount,
        public array $allocations,
    ) {}

    public function isReceipt(): bool
    {
        return $this->kind === 'receipt';
    }
}
