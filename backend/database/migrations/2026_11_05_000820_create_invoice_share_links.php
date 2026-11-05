<?php

declare(strict_types=1);

use App\Support\Database\Rls;
use App\Support\Database\SqlFile;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Online invoice links (plan 3c.7b). A link is a random 256-bit token shown once; only its SHA-256 is stored (`token_hash`,
 * unique across all tenants because the public page looks a link up by it before any tenant is known, through the narrow
 * `sysops.invoice_link_by_token_hash`). Links can expire and be revoked, and every view is logged without storing the viewer's
 * address (a keyed hash of it) so the owner can see that and when an invoice was opened.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('invoice_share_links', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            Rls::companyColumn($table);
            Rls::companyRef($table, 'invoice_id', 'invoices');
            $table->char('token_hash', 64)->unique();
            /** manual (made on the invoice page) or email (made when an email with the link was sent). */
            $table->string('channel', 16);
            $table->uuid('created_by')->nullable();
            $table->timestampTz('expires_at')->nullable();
            $table->timestampTz('revoked_at')->nullable();
            $table->uuid('revoked_by')->nullable();
            $table->unsignedInteger('view_count')->default(0);
            $table->timestampTz('last_viewed_at')->nullable();
            $table->timestampsTz();
            $table->index(['invoice_id', 'created_at']);
            $table->unique(['tenant_id', 'id']);
        });
        DB::statement("ALTER TABLE invoice_share_links ADD CONSTRAINT invoice_share_links_channel CHECK (channel IN ('manual', 'email'))");
        Rls::enable(DB::connection(), 'invoice_share_links');

        Schema::create('invoice_link_views', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            Rls::companyColumn($table);
            $table->uuid('link_id');
            $table->foreign(['tenant_id', 'link_id'])->references(['tenant_id', 'id'])->on('invoice_share_links')->cascadeOnDelete();
            /** page (the invoice was opened) or pdf (the PDF was asked for). */
            $table->string('kind', 8);
            /** HMAC of the viewer's address with the app key: tells repeat visits apart without keeping the address. */
            $table->char('viewer_hash', 64);
            $table->string('user_agent', 200)->nullable();
            $table->timestampTz('viewed_at');
            $table->index(['link_id', 'viewed_at']);
        });
        Rls::enable(DB::connection(), 'invoice_link_views');

        $db = DB::connection();
        $db->statement('SET LOCAL ROLE ledgerly_sysops');
        SqlFile::run($db, 'sysops_invoice_links.sql');
        $db->statement('RESET ROLE');
    }

    public function down(): void
    {
        DB::statement('DROP FUNCTION IF EXISTS sysops.invoice_link_by_token_hash(text)');
        Schema::dropIfExists('invoice_link_views');
        Schema::dropIfExists('invoice_share_links');
    }
};
