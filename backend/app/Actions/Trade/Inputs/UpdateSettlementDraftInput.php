<?php

declare(strict_types=1);

namespace App\Actions\Trade\Inputs;

final readonly class UpdateSettlementDraftInput
{
    public function __construct(public string $settlementId, public int $lockVersion, public SettlementDraftInput $draft) {}
}
