<?php

declare(strict_types=1);

namespace App\Queries\Files;

use App\Models\Files\Attachment;
use Illuminate\Database\Eloquent\Builder;

/** The files of one parent in a company, newest first; rows whose upload never finished are not files yet. */
final class ListAttachments
{
    /** @return Builder<Attachment> */
    public function __invoke(string $companyId, string $type, string $parentId): Builder
    {
        return Attachment::query()->where('company_id', $companyId)
            ->where('attachable_type', $type)->where('attachable_id', $parentId)->whereNotNull('completed_at');
    }
}
