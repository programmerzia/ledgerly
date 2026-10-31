<?php

declare(strict_types=1);

use App\Support\Database\Rls;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/** Invitations, API clients (Sanctum tokenable) and Sanctum tokens (05 §1, §6; 13 §7). */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('invitations', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            $table->string('email');
            $table->enum('role', ['owner', 'admin', 'member'])->default('member');
            $table->string('company_role')->nullable();
            $table->uuid('invited_by');
            $table->string('token_hash')->unique(); // SHA-256 of the raw token; the raw token is never stored
            $table->timestampTz('expires_at');
            $table->timestampTz('accepted_at')->nullable();
            $table->timestampTz('revoked_at')->nullable();
            $table->timestampsTz();
            $table->foreign('invited_by')->references('id')->on('users')->restrictOnDelete();
        });
        DB::statement('ALTER TABLE invitations ALTER COLUMN email TYPE citext');
        DB::statement('ALTER TABLE invitations ADD COLUMN company_ids uuid[] NULL');
        DB::statement('CREATE UNIQUE INDEX invitations_open_email_unique ON invitations (tenant_id, lower(email)) WHERE accepted_at IS NULL AND revoked_at IS NULL');
        Rls::enable(DB::connection(), 'invitations');

        Schema::create('api_clients', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            $table->string('name');
            $table->uuid('created_by');
            $table->timestampTz('last_used_at')->nullable();
            $table->timestampTz('revoked_at')->nullable();
            $table->timestampsTz();
            $table->foreign('created_by')->references('id')->on('users')->restrictOnDelete();
        });
        DB::statement('ALTER TABLE api_clients ADD COLUMN company_ids uuid[] NOT NULL');
        Rls::enable(DB::connection(), 'api_clients');

        // Global table (on Rls::GLOBAL_TABLES): no RLS. tenant_id lets the request pipeline set the tenant
        // context before Sanctum loads the RLS-protected ApiClient tokenable.
        Schema::create('personal_access_tokens', function (Blueprint $table) {
            $table->id();
            $table->uuidMorphs('tokenable');
            $table->uuid('tenant_id')->nullable();
            $table->text('name');
            $table->string('token', 64)->unique();
            $table->text('abilities')->nullable();
            $table->timestampTz('last_used_at')->nullable();
            $table->timestampTz('expires_at')->nullable()->index();
            $table->timestampsTz();
            $table->index('tenant_id');
            $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('personal_access_tokens');
        Schema::dropIfExists('api_clients');
        Schema::dropIfExists('invitations');
    }
};
