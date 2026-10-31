<?php

declare(strict_types=1);

namespace App\Domain\Ledger;

final readonly class DimensionValueInfo
{
    public function __construct(public string $id, public int $position, public bool $isActive) {}
}
