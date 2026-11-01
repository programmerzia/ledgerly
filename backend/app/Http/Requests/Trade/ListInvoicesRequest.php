<?php

declare(strict_types=1);

namespace App\Http\Requests\Trade;

use App\Domain\Trade\InvoiceKind;
use App\Domain\Trade\PaymentStatus;
use App\Http\Requests\CompanyRequest;
use App\Queries\Trade\InvoiceFilter;
use Illuminate\Validation\Rule;

/**
 * Filters of GET /invoices and GET /bills: `kind`, `status` (ledger status), `payment_status` (the derived business
 * status), `overdue`, `contact_id`, `issued_from|to`, `due_from|to`, `search`; paging is CursorPage's.
 */
final class ListInvoicesRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'kind' => ['nullable', 'string', Rule::in(InvoiceKind::values(...($this->sales() ? InvoiceKind::sales() : InvoiceKind::purchases())))],
            'status' => ['nullable', 'string', Rule::in(['draft', 'pending_approval', 'posted', 'reversed', 'void'])],
            'payment_status' => ['nullable', 'string', Rule::in(array_map(fn (PaymentStatus $s) => $s->value, PaymentStatus::cases()))],
            'overdue' => ['nullable', 'string', 'in:true,false,1,0'],
            'contact_id' => ['nullable', 'uuid'],
            'issued_from' => ['nullable', 'date_format:Y-m-d'],
            'issued_to' => ['nullable', 'date_format:Y-m-d'],
            'due_from' => ['nullable', 'date_format:Y-m-d'],
            'due_to' => ['nullable', 'date_format:Y-m-d'],
            'search' => ['nullable', 'string', 'max:100'],
        ];
    }

    public function filter(): InvoiceFilter
    {
        $v = $this->validated();

        return new InvoiceFilter(
            kinds: isset($v['kind']) ? [InvoiceKind::from((string) $v['kind'])] : ($this->sales() ? InvoiceKind::sales() : InvoiceKind::purchases()),
            status: isset($v['status']) ? (string) $v['status'] : null,
            contactId: isset($v['contact_id']) ? (string) $v['contact_id'] : null,
            issuedFrom: isset($v['issued_from']) ? (string) $v['issued_from'] : null,
            issuedTo: isset($v['issued_to']) ? (string) $v['issued_to'] : null,
            dueFrom: isset($v['due_from']) ? (string) $v['due_from'] : null,
            dueTo: isset($v['due_to']) ? (string) $v['due_to'] : null,
            paymentStatus: isset($v['payment_status']) ? PaymentStatus::from((string) $v['payment_status']) : null,
            overdue: $this->filled('overdue') ? $this->boolean('overdue') : null,
            search: isset($v['search']) ? (string) $v['search'] : null,
        );
    }

    private function sales(): bool
    {
        return ! str_starts_with((string) $this->route()?->getName(), 'bills.');
    }
}
