<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Reverse charge on bills (13 §23 D15 item 4, plan 3c.11). The supplier does not charge the tax, so it is not in the bill's total
 * or `tax_total`; the buyer self-assesses it. It is kept apart: per line `reverse_charge_fc` (the line's `tax_code_id` names the
 * reverse-charge code), per document `reverse_charge_total_fc` and, converted once (D1), `reverse_charge_total` in base. Zero on every
 * other document, so bills that are not reverse charge are unchanged. Set while the document is a draft; the posted-row guard on
 * invoices already freezes every column except its whitelist, which these are not in.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('ALTER TABLE invoices ADD COLUMN reverse_charge_total_fc bigint NOT NULL DEFAULT 0, ADD COLUMN reverse_charge_total bigint NOT NULL DEFAULT 0');
        DB::statement('ALTER TABLE invoices ADD CONSTRAINT invoices_reverse_charge_check CHECK (reverse_charge_total_fc >= 0 AND reverse_charge_total >= 0)');
        DB::statement('ALTER TABLE invoice_lines ADD COLUMN reverse_charge_fc bigint NOT NULL DEFAULT 0');
        DB::statement('ALTER TABLE invoice_lines ADD CONSTRAINT invoice_lines_reverse_charge_check CHECK (reverse_charge_fc >= 0)');
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE invoice_lines DROP COLUMN reverse_charge_fc');
        DB::statement('ALTER TABLE invoices DROP COLUMN reverse_charge_total_fc, DROP COLUMN reverse_charge_total');
    }
};
