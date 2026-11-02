<?php

declare(strict_types=1);

namespace App\Http\Requests\Recurring;

/** A recurring invoice or bill: the template is a posted invoice or bill. */
final class RecurringInvoiceRequest extends RecurringScheduleRequest
{
    protected function templateTable(): string
    {
        return 'invoices';
    }
}
