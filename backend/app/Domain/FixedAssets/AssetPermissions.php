<?php

declare(strict_types=1);

namespace App\Domain\FixedAssets;

/** The permission each kind of asset transaction needs to be drafted and submitted. Approving, returning and voiding need `fixed_assets.approve`; reversing `fixed_assets.reverse`. */
final class AssetPermissions
{
    public const array FOR_KIND = [
        'disposal' => 'fixed_assets.dispose', 'impairment' => 'fixed_assets.revalue',
        'impairment_reversal' => 'fixed_assets.revalue', 'revaluation' => 'fixed_assets.revalue',
    ];
}
