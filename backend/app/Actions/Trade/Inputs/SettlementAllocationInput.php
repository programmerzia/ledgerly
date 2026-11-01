<?php

declare(strict_types=1);

namespace App\Actions\Trade\Inputs;

final readonly class SettlementAllocationInput
{
    public function __construct(public int $amountFc, public ?string $invoiceId = null, public ?string $sourceSettlementId = null) {}
}
