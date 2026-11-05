<?php

declare(strict_types=1);

namespace App\Support\Database;

use Illuminate\Support\Facades\Schema;

/**
 * For migrations that add a new matrix permission to roles by name (13 §7, plan 3c.25). Companies can edit their seeded roles, so a
 * backfill must give the new permission to unedited system roles only: not to a role someone changed, and not to a custom role.
 *
 * Usage in a role-joined INSERT … SELECT: `WHERE r.name = ? AND r.guard_name = 'web'` . RoleBackfill::uneditedOnly()
 *
 * Migrations that ran before the flags existed (the columns do not exist yet) get an empty condition: no role could have been edited then.
 */
final class RoleBackfill
{
    /** An SQL condition (leading ` AND `) on the alias `r` for `roles`, or an empty string while the flag columns do not exist. */
    public static function uneditedOnly(): string
    {
        return Schema::hasColumn('roles', 'permissions_edited') ? ' AND r.is_system AND NOT r.permissions_edited' : '';
    }
}
