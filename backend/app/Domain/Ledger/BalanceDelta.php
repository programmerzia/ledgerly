<?php

declare(strict_types=1);

namespace App\Domain\Ledger;

final readonly class BalanceDelta
{
    /** @param array<int, string|null> $dims */
    public function __construct(
        public string $accountId,
        public array $dims,
        public int $debit,
        public int $credit,
    ) {}

    public function dimKey(): string
    {
        return DimKey::of($this->dims);
    }
}
