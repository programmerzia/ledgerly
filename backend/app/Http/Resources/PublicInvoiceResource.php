<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Contracts\Clock;
use App\Domain\Trade\PaymentStatus;
use App\Http\Support\Json;
use App\Models\Trade\Contact;
use App\Models\Trade\InvoiceLine;
use App\Services\Documents\DocumentLook;
use App\Services\Sharing\OpenedInvoiceLink;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * What a customer sees on the online invoice page (plan 3c.7b), and nothing more: the invoice as issued, its status and the
 * balance still due, and how to pay. No ids, no company or contact details beyond the two names on the invoice, no internal
 * memo, no accounts. A reversed invoice shows that status and no balance.
 *
 * It is built while the link's tenant context is held (`build`), so it reads the database only there; sending it afterwards
 * touches nothing.
 */
final class PublicInvoiceResource extends JsonResource
{
    public static function build(OpenedInvoiceLink $opened): self
    {
        $invoice = $opened->invoice;
        $currency = $invoice->currency;
        $reversed = $invoice->status->value === 'reversed';
        $status = PaymentStatus::of($invoice->status, $invoice->amountDue(), $invoice->settled, $invoice->due_date, app(Clock::class)->now())->value;

        return new self([
            'company_name' => $opened->company->name,
            'bill_to' => (string) Contact::query()->whereKey($invoice->contact_id)->value('name'),
            'number' => (string) $invoice->number,
            'issue_date' => (string) Json::date($invoice->issue_date),
            'due_date' => (string) Json::date($invoice->due_date),
            'currency' => $currency,
            'status' => $reversed ? 'reversed' : ($status === 'awaiting_payment' ? 'open' : $status),
            'balance_due' => $reversed ? null : Json::money($invoice->amountDueFc(), $currency),
            'subtotal' => Json::money($invoice->subtotal_fc, $currency),
            'tax_total' => Json::money($invoice->tax_total_fc, $currency),
            'total' => Json::money($invoice->total_fc, $currency),
            'lines' => $invoice->lines->map(fn (InvoiceLine $l): array => [
                'description' => $l->description,
                'quantity' => (string) $l->quantity,
                'unit_price' => Json::money($l->unit_price_fc, $currency),
                'line_total' => Json::money($l->line_total_fc, $currency),
                'tax_amount' => Json::money($l->tax_amount_fc, $currency),
            ])->values()->all(),
            'payment_instructions' => app(DocumentLook::class)->for($opened->company->id)['payment_instructions'],
        ]);
    }

    /**
     * `status` is open (awaiting payment), partially_paid, overdue, paid or reversed. `balance_due` is what is still owed, in the
     * invoice currency, and null once the invoice is reversed. `payment_instructions` is how to pay, as the company wrote it for
     * its documents; empty when it wrote none.
     *
     * @return array{
     *     company_name: string, bill_to: string, number: string, issue_date: string, due_date: string, currency: string, status: string,
     *     balance_due: array{amount: int, currency: string}|null,
     *     subtotal: array{amount: int, currency: string}, tax_total: array{amount: int, currency: string}, total: array{amount: int, currency: string},
     *     lines: list<array{description: string|null, quantity: string, unit_price: array{amount: int, currency: string}, line_total: array{amount: int, currency: string}, tax_amount: array{amount: int, currency: string}}>,
     *     payment_instructions: string
     * }
     */
    public function toArray(Request $request): array
    {
        /** @var array{company_name: string, bill_to: string, number: string, issue_date: string, due_date: string, currency: string, status: string, balance_due: array{amount: int, currency: string}|null, subtotal: array{amount: int, currency: string}, tax_total: array{amount: int, currency: string}, total: array{amount: int, currency: string}, lines: list<array{description: string|null, quantity: string, unit_price: array{amount: int, currency: string}, line_total: array{amount: int, currency: string}, tax_amount: array{amount: int, currency: string}}>, payment_instructions: string} $data */
        $data = $this->resource;

        return $data;
    }
}
