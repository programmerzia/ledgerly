<?php

declare(strict_types=1);

use App\Support\Database\Rls;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Files on documents and contacts (05 §12, 13 §17, plan 2.17). `attachable_type` is a short allowlisted name, not a
 * class: journal, invoice, bill, contact, settlement. The parent has no foreign key
 * (it lives in several tables); the Actions check it in the same company. `path` is an unguessable object key that
 * holds the tenant and company ids. A row stays after its file is deleted (infected, rejected) as the record.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('attachments', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            Rls::companyColumn($table);
            $table->string('attachable_type', 16);
            $table->uuid('attachable_id');
            $table->string('disk', 32);
            $table->string('path', 255);
            $table->string('original_name', 160); // sanitised at intake; the name a download is saved as
            $table->string('mime', 127); // the client's claim until the scan sniffs the bytes
            $table->bigInteger('size');
            $table->char('sha256', 64);
            $table->enum('scan_status', ['pending', 'clean', 'infected', 'error'])->default('pending');
            $table->string('scan_detail', 200)->nullable(); // signature name, or why it was rejected
            $table->timestampTz('completed_at')->nullable(); // set once the upload is verified; null = still waiting for bytes
            $table->timestampTz('scanned_at')->nullable();
            $table->integer('scan_attempts')->default(0);
            $table->timestampTz('scan_checked_at')->nullable();
            $table->boolean('added_after_posting')->default(false);
            $table->uuid('uploaded_by')->nullable(); // a user or an API client; no FK, like audit actors
            $table->integer('lock_version')->default(0);
            $table->timestampsTz();
            $table->index(['company_id', 'attachable_type', 'attachable_id']);
            $table->index(['scan_status', 'completed_at']);
            $table->unique(['tenant_id', 'company_id', 'id']);
        });
        DB::statement("ALTER TABLE attachments ADD CONSTRAINT attachments_type_check CHECK (attachable_type IN ('journal', 'invoice', 'bill', 'contact', 'settlement'))");
        DB::statement('ALTER TABLE attachments ADD CONSTRAINT attachments_size_check CHECK (size > 0)');
        DB::statement("ALTER TABLE attachments ADD CONSTRAINT attachments_sha_check CHECK (sha256 ~ '^[0-9a-f]{64}$')");
        Rls::enable(DB::connection(), 'attachments');
    }

    public function down(): void
    {
        Schema::dropIfExists('attachments');
    }
};
