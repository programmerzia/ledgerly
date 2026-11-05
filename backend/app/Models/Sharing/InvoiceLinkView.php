<?php

declare(strict_types=1);

namespace App\Models\Sharing;

use App\Models\BaseModel;
use Carbon\CarbonImmutable;

/**
 * One opening of an online invoice link.
 *
 * @property string $id
 * @property string $link_id
 * @property string $kind page | pdf
 * @property string $viewer_hash
 * @property string|null $user_agent
 * @property CarbonImmutable $viewed_at
 */
class InvoiceLinkView extends BaseModel
{
    public $timestamps = false;

    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['viewed_at' => 'immutable_datetime'];
    }
}
