<?php

declare(strict_types=1);

namespace App\Domain\Ledger;

enum ControlType: string
{
    case None = 'none';
    case Ar = 'ar';
    case Ap = 'ap';
    case Bank = 'bank';
    case Cash = 'cash';
    case Tax = 'tax';
    case RetainedEarnings = 'retained_earnings';
    case Suspense = 'suspense';
    case FixedAsset = 'fixed_asset';
    case AccumDepr = 'accum_depr';

    public function blocksManualJournals(): bool
    {
        return in_array($this, [self::Ar, self::Ap, self::Bank], true);
    }

    public function requiresContact(): bool
    {
        return $this === self::Ar || $this === self::Ap;
    }
}
