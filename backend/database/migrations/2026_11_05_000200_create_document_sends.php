<?php

declare(strict_types=1);

use App\Support\Database\Rls;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * The send log of documents emailed from Ledgerly (plan 3c.5): one row per send, with who queued it, to whom, the exact
 * subject and body that went out, and how it ended. `status` moves queued → sent | failed and never back; a bounce that
 * the mail stack reports later is not tracked (SMTP gives no callback). The log is evidence, so rows are only updated by
 * the sender job and never deleted.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('document_sends', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            Rls::companyColumn($table);
            $table->string('document_type', 32);
            $table->uuid('document_id');
            $table->uuid('contact_id')->nullable();
            $table->jsonb('recipients');
            $table->string('subject');
            $table->text('body');
            $table->string('attachment_name');
            $table->jsonb('parameters')->default('{}');
            $table->string('status', 16)->default('queued');
            $table->text('error')->nullable();
            $table->uuid('queued_by')->nullable();
            $table->timestampTz('queued_at');
            $table->timestampTz('sent_at')->nullable();
            $table->timestampsTz();
            $table->index(['company_id', 'document_type', 'document_id', 'queued_at']);
        });
        DB::statement("ALTER TABLE document_sends ADD CONSTRAINT document_sends_status_check CHECK (status IN ('queued', 'sent', 'failed'))");
        Rls::enable(DB::connection(), 'document_sends');
    }

    public function down(): void
    {
        Schema::dropIfExists('document_sends');
    }
};
