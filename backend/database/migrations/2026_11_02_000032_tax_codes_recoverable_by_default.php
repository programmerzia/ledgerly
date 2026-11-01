<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * VAT and GST are normally recoverable. With the old default of false, a bill on a code created without the
 * flag silently added its tax to the expense. Irrecoverable tax is the exception, so it must be chosen.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('ALTER TABLE tax_codes ALTER COLUMN is_recoverable SET DEFAULT true');
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE tax_codes ALTER COLUMN is_recoverable SET DEFAULT false');
    }
};
