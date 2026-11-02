<?php

declare(strict_types=1);

use App\Support\Database\Rls;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Banking (05 §10, 2.13). Deltas from 05: a match is a group (`bank_matches` + `bank_match_items`) because one statement
 * line may match several book lines and the reverse, so `bank_statement_lines.matched_journal_line_id` is not stored; a
 * rule may belong to one bank account or to all (`bank_account_id` null) as in the mock; a reconciliation belongs to one
 * statement, its report is a snapshot taken when it was finished. The statement-line hash makes an import idempotent.
 * Settlements and payment runs get their `bank_account_id` foreign key here (2.12 left it open).
 *
 * Immutability: a finished reconciliation and the matches it covers cannot be changed or deleted (SQLSTATE LG020, LG021);
 * `reopen` is the one door, and it clears the covering link first.
 */
return new class extends Migration
{
    public function up(): void
    {
        // Composite company foreign keys to a journal line need the scope unique (journal_lines had only its primary key).
        DB::statement('ALTER TABLE journal_lines ADD CONSTRAINT journal_lines_scope_unique UNIQUE (tenant_id, company_id, id)');

        Schema::create('bank_accounts', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            Rls::companyColumn($table);
            $table->string('name');
            Rls::companyRef($table, 'account_id', 'accounts');
            $table->char('currency', 3);
            $table->string('bank_name')->nullable();
            $table->string('account_number_masked')->nullable();
            $table->string('iban', 34)->nullable();
            $table->string('swift', 11)->nullable();
            $table->enum('kind', ['bank', 'cash', 'card'])->default('bank');
            $table->jsonb('import_mapping')->nullable();
            $table->bigInteger('last_statement_balance')->nullable();
            $table->date('last_statement_date')->nullable();
            $table->boolean('is_active')->default(true);
            $table->integer('lock_version')->default(0);
            $table->timestampsTz();
            $table->unique(['tenant_id', 'company_id', 'id']);
            $table->unique(['company_id', 'account_id']);
            $table->unique(['company_id', 'name']);
            $table->foreign('currency')->references('code')->on('currencies');
        });
        Rls::enable(DB::connection(), 'bank_accounts');

        Schema::create('bank_statements', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            Rls::companyColumn($table);
            Rls::companyRef($table, 'bank_account_id', 'bank_accounts');
            $table->date('period_from');
            $table->date('period_to');
            $table->bigInteger('opening_balance')->nullable();
            $table->bigInteger('closing_balance')->nullable();
            $table->char('currency', 3);
            $table->enum('source', ['csv', 'ofx', 'camt', 'manual']);
            $table->string('file_name')->nullable();
            $table->char('file_hash', 64);
            $table->integer('line_count')->default(0);
            $table->integer('duplicates_skipped')->default(0);
            $table->jsonb('warnings')->default('[]');
            $table->uuid('imported_by')->nullable();
            $table->timestampTz('imported_at');
            $table->timestampsTz();
            $table->unique(['tenant_id', 'company_id', 'id']);
            $table->unique(['bank_account_id', 'file_hash']);
            $table->index(['bank_account_id', 'period_to']);
        });
        Rls::enable(DB::connection(), 'bank_statements');

        Schema::create('bank_statement_lines', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            Rls::companyColumn($table);
            Rls::companyRef($table, 'statement_id', 'bank_statements');
            Rls::companyRef($table, 'bank_account_id', 'bank_accounts');
            $table->integer('line_no');
            $table->date('txn_date');
            $table->date('value_date')->nullable();
            $table->bigInteger('amount'); // signed, account currency: money in is positive (a debit to the bank account)
            $table->char('currency', 3);
            $table->text('description')->default('');
            $table->string('reference')->nullable();
            $table->string('counterparty')->nullable();
            $table->bigInteger('balance_after')->nullable();
            $table->char('dedupe_hash', 64);
            $table->enum('status', ['unmatched', 'matched', 'excluded'])->default('unmatched');
            $table->integer('lock_version')->default(0);
            $table->timestampsTz();
            $table->unique(['tenant_id', 'company_id', 'id']);
            $table->unique(['bank_account_id', 'dedupe_hash']);
            $table->index(['bank_account_id', 'status', 'txn_date']);
            $table->index(['statement_id', 'line_no']);
        });
        DB::statement('ALTER TABLE bank_statement_lines ADD CONSTRAINT bank_statement_lines_amount_check CHECK (amount <> 0)');
        Rls::enable(DB::connection(), 'bank_statement_lines');

        Schema::create('bank_reconciliations', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            Rls::companyColumn($table);
            Rls::companyRef($table, 'bank_account_id', 'bank_accounts');
            Rls::companyRef($table, 'statement_id', 'bank_statements');
            $table->date('as_of');
            $table->enum('status', ['in_progress', 'finished'])->default('in_progress');
            $table->bigInteger('book_balance')->nullable();
            $table->bigInteger('statement_balance')->nullable();
            $table->bigInteger('difference')->nullable();
            $table->jsonb('report')->nullable();
            $table->uuid('started_by')->nullable();
            $table->uuid('finished_by')->nullable();
            $table->timestampTz('finished_at')->nullable();
            $table->uuid('reopened_by')->nullable();
            $table->timestampTz('reopened_at')->nullable();
            $table->text('reopen_reason')->nullable();
            $table->integer('reopen_count')->default(0);
            $table->integer('lock_version')->default(0);
            $table->timestampsTz();
            $table->unique(['tenant_id', 'company_id', 'id']);
            $table->unique('statement_id');
            $table->index(['bank_account_id', 'as_of']);
        });
        DB::statement("ALTER TABLE bank_reconciliations ADD CONSTRAINT bank_reconciliations_finished_check CHECK (status <> 'finished' OR (difference = 0 AND book_balance IS NOT NULL AND statement_balance IS NOT NULL AND finished_at IS NOT NULL AND report IS NOT NULL))");
        Rls::enable(DB::connection(), 'bank_reconciliations');

        Schema::create('bank_matches', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            Rls::companyColumn($table);
            Rls::companyRef($table, 'bank_account_id', 'bank_accounts');
            $table->bigInteger('amount'); // signed total of either side; the two sides are equal
            $table->uuid('matched_by')->nullable();
            $table->timestampTz('matched_at');
            // Set while a finished reconciliation covers the match (immutable then).
            Rls::companyRef($table, 'reconciliation_id', 'bank_reconciliations', nullable: true);
            $table->timestampsTz();
            $table->unique(['tenant_id', 'company_id', 'id']);
            $table->index(['bank_account_id']);
        });
        Rls::enable(DB::connection(), 'bank_matches');

        Schema::create('bank_match_items', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            Rls::companyColumn($table);
            Rls::companyRef($table, 'match_id', 'bank_matches');
            Rls::companyRef($table, 'statement_line_id', 'bank_statement_lines', nullable: true);
            Rls::companyRef($table, 'journal_line_id', 'journal_lines', nullable: true);
            Rls::companyRef($table, 'settlement_id', 'settlements', nullable: true);
            $table->bigInteger('amount'); // signed, account currency
            $table->timestampsTz();
            $table->index('match_id');
        });
        // A line sits in at most one match (the double-match constraint), whichever side it is on.
        DB::statement('CREATE UNIQUE INDEX bank_match_items_statement_line_unique ON bank_match_items (statement_line_id) WHERE statement_line_id IS NOT NULL');
        DB::statement('CREATE UNIQUE INDEX bank_match_items_journal_line_unique ON bank_match_items (journal_line_id) WHERE journal_line_id IS NOT NULL');
        DB::statement('ALTER TABLE bank_match_items ADD CONSTRAINT bank_match_items_one_side CHECK ((statement_line_id IS NULL) <> (journal_line_id IS NULL))');
        Rls::enable(DB::connection(), 'bank_match_items');

        Schema::create('bank_rules', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            Rls::companyColumn($table);
            Rls::companyRef($table, 'bank_account_id', 'bank_accounts', nullable: true);
            $table->string('name');
            $table->integer('priority');
            $table->jsonb('conditions');
            $table->jsonb('action');
            $table->boolean('is_active')->default(true);
            $table->integer('times_applied')->default(0);
            $table->integer('lock_version')->default(0);
            $table->timestampsTz();
            $table->unique(['tenant_id', 'company_id', 'id']);
            $table->index(['company_id', 'priority']);
        });
        Rls::enable(DB::connection(), 'bank_rules');

        Schema::create('bank_transactions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            Rls::companyColumn($table);
            Rls::companyRef($table, 'bank_account_id', 'bank_accounts');
            Rls::companyRef($table, 'statement_line_id', 'bank_statement_lines');
            Rls::companyRef($table, 'journal_id', 'journals');
            $table->enum('kind', ['spend', 'receive', 'transfer']);
            Rls::companyRef($table, 'to_bank_account_id', 'bank_accounts', nullable: true);
            $table->uuid('rule_id')->nullable();
            $table->bigInteger('gross'); // account currency, positive
            $table->char('currency', 3);
            $table->uuid('created_by')->nullable();
            $table->timestampsTz();
            $table->unique(['tenant_id', 'company_id', 'id']);
            $table->unique('journal_id');
            $table->index('statement_line_id');
        });
        Rls::enable(DB::connection(), 'bank_transactions');

        // The 2.12 columns get their foreign keys.
        foreach (['settlements', 'payment_runs'] as $table) {
            DB::statement("ALTER TABLE {$table} ADD CONSTRAINT {$table}_bank_account_fk FOREIGN KEY (tenant_id, company_id, bank_account_id) REFERENCES bank_accounts (tenant_id, company_id, id) ON DELETE RESTRICT");
        }

        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION bank_reconciliation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
              IF TG_OP = 'DELETE' THEN
                IF OLD.status = 'finished' THEN
                  RAISE EXCEPTION 'bank_reconciliation_guard: reconciliation % is finished', OLD.id USING ERRCODE = 'LG020';
                END IF;
                RETURN OLD;
              END IF;
              -- A finished reconciliation changes only by being reopened (back to in_progress).
              IF OLD.status = 'finished' AND NEW.status = 'finished' THEN
                RAISE EXCEPTION 'bank_reconciliation_guard: reconciliation % is finished', OLD.id USING ERRCODE = 'LG020';
              END IF;
              RETURN NEW;
            END
            $$;
            CREATE TRIGGER bank_reconciliation_guard BEFORE UPDATE OR DELETE ON bank_reconciliations
              FOR EACH ROW EXECUTE FUNCTION bank_reconciliation_guard();

            -- Matches covered by a finished reconciliation are frozen; only reopen may release the cover (reconciliation_id -> NULL).
            CREATE OR REPLACE FUNCTION bank_match_guard() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
              IF TG_OP = 'DELETE' THEN
                IF OLD.reconciliation_id IS NOT NULL THEN
                  RAISE EXCEPTION 'bank_match_guard: match % is covered by a finished reconciliation', OLD.id USING ERRCODE = 'LG021';
                END IF;
                RETURN OLD;
              END IF;
              IF OLD.reconciliation_id IS NOT NULL AND NEW.reconciliation_id IS NOT NULL THEN
                RAISE EXCEPTION 'bank_match_guard: match % is covered by a finished reconciliation', OLD.id USING ERRCODE = 'LG021';
              END IF;
              RETURN NEW;
            END
            $$;
            CREATE TRIGGER bank_match_guard BEFORE UPDATE OR DELETE ON bank_matches
              FOR EACH ROW EXECUTE FUNCTION bank_match_guard();

            CREATE OR REPLACE FUNCTION bank_match_items_guard() RETURNS trigger LANGUAGE plpgsql AS $$
            DECLARE covered uuid;
            BEGIN
              SELECT reconciliation_id INTO covered FROM bank_matches WHERE id = COALESCE(OLD.match_id, NEW.match_id);
              IF covered IS NOT NULL THEN
                RAISE EXCEPTION 'bank_match_items_guard: match % is covered by a finished reconciliation', COALESCE(OLD.match_id, NEW.match_id) USING ERRCODE = 'LG021';
              END IF;
              IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
              RETURN NEW;
            END
            $$;
            CREATE TRIGGER bank_match_items_guard BEFORE UPDATE OR DELETE ON bank_match_items
              FOR EACH ROW EXECUTE FUNCTION bank_match_items_guard();
        SQL);
    }

    public function down(): void
    {
        foreach (['settlements', 'payment_runs'] as $table) {
            DB::statement("ALTER TABLE {$table} DROP CONSTRAINT IF EXISTS {$table}_bank_account_fk");
        }
        DB::unprepared('DROP FUNCTION IF EXISTS bank_reconciliation_guard() CASCADE; DROP FUNCTION IF EXISTS bank_match_guard() CASCADE; DROP FUNCTION IF EXISTS bank_match_items_guard() CASCADE;');
        foreach (['bank_transactions', 'bank_rules', 'bank_match_items', 'bank_matches', 'bank_reconciliations', 'bank_statement_lines', 'bank_statements', 'bank_accounts'] as $table) {
            Schema::dropIfExists($table);
        }
        DB::statement('ALTER TABLE journal_lines DROP CONSTRAINT IF EXISTS journal_lines_scope_unique');
    }
};
