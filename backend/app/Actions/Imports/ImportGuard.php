<?php

declare(strict_types=1);

namespace App\Actions\Imports;

use App\Contracts\PermissionChecker;
use App\Domain\Shared\DomainRuleViolation;
use App\Models\Imports\Import;
use App\Services\Imports\ImportKind;
use App\Support\Actor;
use App\Support\ActorType;

/**
 * Who may touch an import: a person (never a token) holding the permission of the import's kind in its company. Checked by the route
 * policy and again here, because the UI and the policy are never trusted (13 §7).
 */
final class ImportGuard
{
    public function __construct(private readonly PermissionChecker $permissions) {}

    public function require(Actor $actor, ImportKind $kind, string $companyId): void
    {
        if ($actor->type !== ActorType::User || $actor->id === null) {
            throw DomainRuleViolation::single('forbidden', 'Only a person can import data.');
        }
        if (! $this->permissions->allows($actor, $kind->permission(), $companyId)) {
            throw DomainRuleViolation::single('forbidden', "Importing {$kind->key()} needs the {$kind->permission()} permission.");
        }
    }

    public function requireOpen(Import $import): void
    {
        if ($import->rows_purged_at !== null) {
            throw DomainRuleViolation::single('import_purged', 'The rows of this import were purged; upload the file again.');
        }
    }
}
