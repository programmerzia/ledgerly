<?php

declare(strict_types=1);

namespace App\Policies\Imports;

use App\Models\Imports\Import;
use App\Policies\PolicyContext;
use App\Services\Imports\ImportKinds;
use Illuminate\Contracts\Auth\Authenticatable;

/**
 * Imports are a person's work (API tokens never import). What a person may do with an import is decided by the permission of its kind:
 * contacts.manage, accounts.manage, invoices.create, banking.reconcile, and settings.manage for opening balances (which post a journal;
 * the signing grant is asked for when apply is requested, inside the Action). Listing and uploading need at least one of them; the
 * Action checks the permission of the kind actually uploaded.
 */
final class ImportPolicy
{
    public function __construct(private readonly PolicyContext $context) {}

    public function viewAny(Authenticatable $principal): bool
    {
        foreach (ImportKinds::permissions() as $permission) {
            if ($this->context->personCan($principal, $permission)) {
                return true;
            }
        }

        return false;
    }

    /**
     * The kinds this person may see imports of.
     *
     * @return list<string>
     */
    public function kindsFor(Authenticatable $principal): array
    {
        $kinds = [];
        foreach (ImportKinds::permissions() as $kind => $permission) {
            if ($this->context->personCan($principal, $permission)) {
                $kinds[] = $kind;
            }
        }

        return $kinds;
    }

    public function create(Authenticatable $principal): bool
    {
        return $this->viewAny($principal);
    }

    public function view(Authenticatable $principal, Import $import): bool
    {
        $permission = ImportKinds::permissions()[$import->kind] ?? null;

        return $permission !== null && $this->context->personCan($principal, $permission, $import->company_id);
    }

    public function update(Authenticatable $principal, Import $import): bool
    {
        return $this->view($principal, $import);
    }

    public function apply(Authenticatable $principal, Import $import): bool
    {
        return $this->view($principal, $import);
    }

    public function purge(Authenticatable $principal, Import $import): bool
    {
        return $this->view($principal, $import);
    }
}
