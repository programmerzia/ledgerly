<?php

declare(strict_types=1);

namespace App\Actions\Ledger\Inputs;

final readonly class ApplyChartTemplateInput
{
    public function __construct(public string $companyId, public string $templateCode) {}
}
