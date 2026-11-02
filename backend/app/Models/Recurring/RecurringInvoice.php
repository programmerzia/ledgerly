<?php

declare(strict_types=1);

namespace App\Models\Recurring;

use App\Models\Trade\Invoice;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A schedule of invoices or bills copied from a posted template.
 *
 * @property string $template_invoice_id
 */
class RecurringInvoice extends RecurringSchedule
{
    /** @return BelongsTo<Invoice, $this> */
    public function template(): BelongsTo
    {
        return $this->belongsTo(Invoice::class, 'template_invoice_id');
    }

    public function scheduleType(): string
    {
        return 'recurring_invoice';
    }

    public function templateId(): string
    {
        return $this->template_invoice_id;
    }
}
