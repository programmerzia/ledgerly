<?php

declare(strict_types=1);

use App\Services\Fiscal\PendingApprovalsCheck;
use App\Services\Fiscal\UnpostedDraftsCheck;
use App\Services\Fx\FxRevaluationCheck;

return [
    // The close checklist (02_AppFlow): BANK_REC, FX_REVAL and DEPR_RUN register here with
    // banking (2.13), FX (2.14) and fixed assets.
    'checks' => [
        UnpostedDraftsCheck::class,
        PendingApprovalsCheck::class,
        FxRevaluationCheck::class,
    ],
];
