<?php

declare(strict_types=1);

namespace App\Domain\Trade;

/**
 * A receipt, a payment, a customer refund (`refund`) or a supplier refund (`supplier_refund`) (D11).
 * Whatever is not allocated stays on the contact's control account as credit on account (D9).
 */
final readonly class SettlementDocument
{
    /**
     * @param  list<SettlementAllocation>  $allocations
     * @param  array<string, string>  $dimensions
     */
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
        public array $dimensions = [],
    ) {}

    public function isCashIn(): bool
    {
        return $this->kind === 'receipt' || $this->kind === 'supplier_refund';
    }

    public function isOnReceivables(): bool
    {
        return $this->kind === 'receipt' || $this->kind === 'refund';
    }

    public function label(): string
    {
        return match ($this->kind) {
            'receipt' => 'Receipt',
            'payment' => 'Payment',
            'refund' => 'Customer refund',
            'supplier_refund' => 'Supplier refund',
            default => throw new \InvalidArgumentException("Unknown settlement kind {$this->kind}."),
        };
    }
}
