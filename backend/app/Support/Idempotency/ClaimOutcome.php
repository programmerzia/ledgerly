<?php

declare(strict_types=1);

namespace App\Support\Idempotency;

enum ClaimOutcome
{
    /** First attempt, or a takeover of an attempt that died before commit: run the request. */
    case Execute;
    /** The key was used for a different request. */
    case Reused;
    /** Another attempt holds a live lease. */
    case InProgress;
    /** Completed earlier: replay the stored response. */
    case Replay;
    /** The change committed but its response was never stored: answer with the subject as it is now. */
    case ReplayCurrent;
}
