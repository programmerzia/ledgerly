<?php

declare(strict_types=1);

namespace App\Domain\FixedAssets;

/** One journal line before it has an account: a role and an amount on one side. */
final readonly class LineSpec
{
    public function __construct(public string $role, public int $debit = 0, public int $credit = 0) {}
}
