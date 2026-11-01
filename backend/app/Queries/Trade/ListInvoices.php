<?php

declare(strict_types=1);

namespace App\Queries\Trade;

use App\Contracts\Clock;
use App\Domain\Trade\InvoiceKind;
use App\Domain\Trade\PaymentStatus;
use App\Models\Trade\Invoice;
use Illuminate\Database\Eloquent\Builder;

/**
 * The company's documents of one family, filtered; the caller paginates (issue date, newest first). Payment status
 * and overdue are derived as docStatus.ts does: amount due = total − withheld tax − settled, in base, for posted
 * documents; "today" is the server clock.
 */
final class ListInvoices
{
    public function __construct(private readonly Clock $clock) {}

    /** @return Builder<Invoice> */
    public function __invoke(string $companyId, InvoiceFilter $f): Builder
    {
        $query = Invoice::query()->where('company_id', $companyId)->whereIn('kind', InvoiceKind::values(...$f->kinds));
        $today = $this->clock->now()->format('Y-m-d');

        if ($f->status !== null) {
            $query->where('status', $f->status);
        }
        if ($f->contactId !== null) {
            $query->where('contact_id', $f->contactId);
        }
        if ($f->issuedFrom !== null) {
            $query->where('issue_date', '>=', $f->issuedFrom);
        }
        if ($f->issuedTo !== null) {
            $query->where('issue_date', '<=', $f->issuedTo);
        }
        if ($f->dueFrom !== null) {
            $query->where('due_date', '>=', $f->dueFrom);
        }
        if ($f->dueTo !== null) {
            $query->where('due_date', '<=', $f->dueTo);
        }
        if ($f->overdue !== null) {
            $overdue = fn (Builder $q) => $q->where('status', 'posted')->where('due_date', '<', $today)->whereRaw('total - wht_amount - settled > 0');
            $f->overdue ? $query->where($overdue) : $query->whereNot($overdue);
        }
        if ($f->paymentStatus !== null) {
            $this->paymentStatus($query, $f->paymentStatus, $today);
        }
        if ($f->search !== null && trim($f->search) !== '') {
            $like = '%'.addcslashes(trim($f->search), '\\%_').'%';
            $query->where(fn (Builder $q) => $q->where('number', 'ilike', $like)->orWhere('reference', 'ilike', $like)->orWhere('memo', 'ilike', $like));
        }

        return $query;
    }

    /** @param Builder<Invoice> $query */
    private function paymentStatus(Builder $query, PaymentStatus $status, string $today): void
    {
        $due = 'total - wht_amount - settled';
        match ($status) {
            PaymentStatus::Draft, PaymentStatus::PendingApproval, PaymentStatus::Reversed, PaymentStatus::Void => $query->where('status', $status->value),
            PaymentStatus::Paid => $query->where('status', 'posted')->whereRaw("{$due} <= 0"),
            PaymentStatus::Overdue => $query->where('status', 'posted')->whereRaw("{$due} > 0")->where('due_date', '<', $today),
            PaymentStatus::AwaitingPayment => $query->where('status', 'posted')->whereRaw("{$due} > 0")->where('due_date', '>=', $today)->where('settled', 0),
            PaymentStatus::PartiallyPaid => $query->where('status', 'posted')->whereRaw("{$due} > 0")->where('due_date', '>=', $today)->where('settled', '>', 0),
        };
    }
}
