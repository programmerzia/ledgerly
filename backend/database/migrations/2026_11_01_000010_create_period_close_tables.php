<?php

declare(strict_types=1);

use App\Support\Database\Rls;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Period close checks and reopen requests (05 §4; 13 §10). The soft-close timestamp joins the
 * close bookkeeping already on fiscal_periods (closed_at, closed_by, reopened_count; 2026_10_30_000004).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('fiscal_periods', function (Blueprint $table) {
            $table->timestampTz('soft_closed_at')->nullable();
        });

        // Outcome of one pre-close check per period; ClosePeriod writes them, a failing one can be waived.
        Schema::create('period_close_checks', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            Rls::companyColumn($table);
            Rls::companyRef($table, 'fiscal_period_id', 'fiscal_periods');
            $table->string('check_code', 64);
            $table->enum('status', ['pass', 'fail', 'waived']);
            $table->jsonb('detail')->nullable();
            $table->timestampTz('checked_at');
            $table->uuid('waived_by')->nullable();
            $table->text('waived_reason')->nullable();
            $table->timestampsTz();
            $table->unique(['fiscal_period_id', 'check_code']);
            $table->foreign('waived_by')->references('id')->on('users')->restrictOnDelete();
        });
        Rls::enable(DB::connection(), 'period_close_checks');

        // Reopening a closed period needs two distinct approvers, neither of them the requester.
        Schema::create('period_reopen_requests', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            Rls::companyColumn($table);
            Rls::companyRef($table, 'fiscal_period_id', 'fiscal_periods');
            $table->uuid('requested_by');
            $table->text('reason');
            $table->enum('status', ['pending', 'approved', 'rejected', 'cancelled'])->default('pending');
            $table->uuid('first_approver')->nullable();
            $table->timestampTz('first_signed_at')->nullable();
            $table->uuid('second_approver')->nullable();
            $table->timestampTz('second_signed_at')->nullable();
            $table->timestampTz('decided_at')->nullable();
            $table->text('decision_comment')->nullable();
            $table->timestampsTz();
            $table->index('fiscal_period_id');
            $table->foreign('requested_by')->references('id')->on('users')->restrictOnDelete();
            $table->foreign('first_approver')->references('id')->on('users')->restrictOnDelete();
            $table->foreign('second_approver')->references('id')->on('users')->restrictOnDelete();
        });
        // requested_by is NOT NULL, so IS DISTINCT FROM already lets an empty approver slot through.
        DB::statement('ALTER TABLE period_reopen_requests ADD CONSTRAINT period_reopen_requests_first_approver_not_requester CHECK (first_approver IS DISTINCT FROM requested_by)');
        DB::statement('ALTER TABLE period_reopen_requests ADD CONSTRAINT period_reopen_requests_second_approver_not_requester CHECK (second_approver IS DISTINCT FROM requested_by)');
        // Two empty slots are "not distinct", hence the NULL guard (as in journals_maker_checker).
        DB::statement('ALTER TABLE period_reopen_requests ADD CONSTRAINT period_reopen_requests_approvers_distinct CHECK (first_approver IS DISTINCT FROM second_approver OR first_approver IS NULL)');
        DB::statement("CREATE UNIQUE INDEX period_reopen_requests_one_pending ON period_reopen_requests (fiscal_period_id) WHERE (status = 'pending')");
        Rls::enable(DB::connection(), 'period_reopen_requests');
    }

    public function down(): void
    {
        Schema::dropIfExists('period_reopen_requests');
        Schema::dropIfExists('period_close_checks');
        Schema::table('fiscal_periods', function (Blueprint $table) {
            $table->dropColumn('soft_closed_at');
        });
    }
};
