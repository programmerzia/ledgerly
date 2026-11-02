<?php

declare(strict_types=1);

namespace App\Services\Trade;

use App\Domain\Workflow\DocumentStatus;
use App\Models\Trade\Invoice;

/** A credit or debit note, with the other posted notes on its original, cannot exceed that original's total. */
final class CreditNoteLimit
{
    /** The refusal message, or null when the note fits. */
    public function refusal(Invoice $note): ?string
    {
        if ($note->related_invoice_id === null) {
            return null;
        }
        $original = Invoice::query()->findOrFail($note->related_invoice_id);
        $others = (int) $original->getConnection()->table('invoices')
            ->where('related_invoice_id', $original->id)->where('status', DocumentStatus::Posted->value)->where('id', '<>', $note->id)
            ->sum($original->getConnection()->raw('total_fc - wht_amount_fc'));
        if ($others + $note->total_fc - $note->wht_amount_fc <= $original->total_fc - $original->wht_amount_fc) {
            return null;
        }

        return "The {$note->kind->label()}s against {$original->number} would be more than the document itself.";
    }
}
