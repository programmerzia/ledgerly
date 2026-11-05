<?php

declare(strict_types=1);

namespace App\Queries\Transactions;

/** A provisioning run for a date, not saved: the buckets (balance, rate, allowance needed), required, held, and the signed difference. Base currency. */
final readonly class ProvisionPreview
{
    /** @param list<array{bucket: string, label: string, balance: int, rate_pct: string, amount: int}> $rows */
    public function __construct(
        public string $asOf,
        public array $rows,
        public int $required,
        public int $existing,
        public int $difference,
    ) {}
}
