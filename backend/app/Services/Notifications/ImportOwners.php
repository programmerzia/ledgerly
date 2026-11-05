<?php

declare(strict_types=1);

namespace App\Services\Notifications;

use App\Models\Imports\Import;

/** Who started an import. Reads inside the tenant context. */
final class ImportOwners
{
    public function starterOf(string $importId): ?string
    {
        if ($importId === '') {
            return null;
        }
        $id = Import::query()->whereKey($importId)->value('created_by');

        return is_string($id) ? $id : null;
    }
}
