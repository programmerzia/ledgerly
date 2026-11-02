<?php

declare(strict_types=1);

use App\Services\Banking\BankReconciliationCheck;
use App\Services\Fiscal\PendingApprovalsCheck;
use App\Services\Fiscal\UnpostedDraftsCheck;
use App\Services\Fx\FxRevaluationCheck;

return [
    // The close checklist (02_AppFlow): DEPR_RUN registers here with fixed assets.
    'checks' => [
        UnpostedDraftsCheck::class,
        PendingApprovalsCheck::class,
        FxRevaluationCheck::class,
        BankReconciliationCheck::class,
    ],
];
