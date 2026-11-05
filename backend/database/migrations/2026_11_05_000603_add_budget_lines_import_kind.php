<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/** Budget amounts can be imported (plan 3c.16): the `imports.kind` check admits `budget_lines`. */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('ALTER TABLE imports DROP CONSTRAINT IF EXISTS imports_kind_check');
        DB::statement("ALTER TABLE imports ADD CONSTRAINT imports_kind_check CHECK (kind::text IN ('contacts', 'accounts', 'opening_balances', 'invoices', 'bank_lines', 'budget_lines'))");
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE imports DROP CONSTRAINT IF EXISTS imports_kind_check');
        DB::statement("ALTER TABLE imports ADD CONSTRAINT imports_kind_check CHECK (kind::text IN ('contacts', 'accounts', 'opening_balances', 'invoices', 'bank_lines'))");
    }
};
