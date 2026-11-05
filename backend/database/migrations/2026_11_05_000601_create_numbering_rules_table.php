<?php

declare(strict_types=1);

use App\Support\Database\Rls;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Configurable document numbering (13 §23 D15 item 6, plan 3c.17). A rule gives the prefix and zero padding a document kind uses for
 * every fiscal year that starts on or after `effective_from`. Rules are only read when a year's sequence is first created
 * (`SequenceAllocator`), so a sequence that already exists is never touched and nothing issued is ever renumbered. A kind with no rule
 * keeps its built-in prefix and 5 digits. Number format: `{prefix}-{fiscal year name}-{counter, zero padded}`.
 *
 * At most one rule per kind and start date; changing a rule that has not started yet replaces it (`lock_version`).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('numbering_rules', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            Rls::companyColumn($table);
            $table->string('doc_kind', 32);
            $table->string('prefix', 8);
            $table->smallInteger('padding');
            $table->date('effective_from');
            $table->integer('lock_version')->default(0);
            $table->uuid('created_by')->nullable();
            $table->timestampsTz();
            $table->unique(['tenant_id', 'company_id', 'doc_kind', 'effective_from']);
            $table->index(['company_id', 'doc_kind']);
        });
        DB::statement("ALTER TABLE numbering_rules ADD CONSTRAINT numbering_rules_prefix_check CHECK (prefix ~ '^[A-Z][A-Z0-9]{0,7}$')");
        DB::statement('ALTER TABLE numbering_rules ADD CONSTRAINT numbering_rules_padding_check CHECK (padding BETWEEN 3 AND 10)');
        Rls::enable(DB::connection(), 'numbering_rules');
    }

    public function down(): void
    {
        Schema::dropIfExists('numbering_rules');
    }
};
