<?php

declare(strict_types=1);

namespace App\Services\Documents;

use App\Domain\Documents\DocMoney;
use App\Domain\Documents\Percent;
use App\Domain\Shared\DomainRuleViolation;
use App\Domain\Shared\FormatPreferences;
use App\Domain\Trade\InvoiceKind;
use App\Models\Banking\BankAccount;
use App\Models\Ledger\Account;
use App\Models\Ledger\Journal;
use App\Models\Organisation\Company;
use App\Models\Platform\User;
use App\Models\Procurement\PurchaseOrder;
use App\Models\Procurement\PurchaseOrderLine;
use App\Models\Tax\TaxCode;
use App\Models\Tax\TaxGroup;
use App\Models\Tax\TaxRate;
use App\Models\Trade\Contact;
use App\Models\Trade\Invoice;
use App\Models\Trade\InvoiceLine;
use App\Models\Trade\Item;
use App\Models\Trade\Settlement;
use App\Models\Trade\WhtCertificate;
use App\Queries\Reports\RunReport;
use App\Support\Formats\CompanyFormats;
use DateTimeInterface;
use Illuminate\Support\Facades\DB;

/**
 * What a printed document shows, taken only from the stored document (plan 3c.4): the numbers are the ones the server
 * stored when it priced and posted the document, nothing is recomputed from client input, and a document that is not
 * posted says so with a watermark. Returns the view name and the data the Blade template needs. Money is formatted from
 * integer minor units in the document's own currency.
 *
 * Types: invoice, credit_note, receipt, bill, debit_note, payment_advice, purchase_order, customer_statement,
 * supplier_statement, journal_voucher, wht_certificate.
 */
final class DocumentData
{
    public const array TYPES = [
        'invoice', 'credit_note', 'receipt', 'bill', 'debit_note', 'payment_advice', 'purchase_order',
        'customer_statement', 'supplier_statement', 'journal_voucher', 'wht_certificate',
    ];

    /** Blade template per type. */
    private const array VIEWS = [
        'invoice' => 'pdf.invoice', 'credit_note' => 'pdf.credit-note', 'receipt' => 'pdf.receipt', 'bill' => 'pdf.bill',
        'debit_note' => 'pdf.debit-note', 'payment_advice' => 'pdf.payment-advice', 'purchase_order' => 'pdf.purchase-order',
        'customer_statement' => 'pdf.customer-statement', 'supplier_statement' => 'pdf.supplier-statement',
        'journal_voucher' => 'pdf.journal-voucher', 'wht_certificate' => 'pdf.wht-certificate',
    ];

    /** The company being printed, set at the start of each build() (plan 3c.26b). */
    private ?FormatPreferences $formats = null;

    public function __construct(
        private readonly DocumentLook $look,
        private readonly LogoStore $logos,
        private readonly RunReport $statements,
    ) {}

    /** The document type a stored invoice, settlement, ... prints as. */
    public static function typeOf(object $model): string
    {
        return match (true) {
            $model instanceof Invoice => match ($model->kind) {
                InvoiceKind::SalesInvoice => 'invoice', InvoiceKind::CreditNote => 'credit_note',
                InvoiceKind::PurchaseBill => 'bill', InvoiceKind::DebitNote => 'debit_note',
            },
            $model instanceof Settlement => in_array($model->kind, ['receipt', 'supplier_refund'], true) ? 'receipt' : 'payment_advice',
            $model instanceof PurchaseOrder => 'purchase_order',
            $model instanceof Journal => 'journal_voucher',
            $model instanceof WhtCertificate => 'wht_certificate',
            default => throw new \InvalidArgumentException('This model has no printed form.'),
        };
    }

    /**
     * @param  array<string, mixed>  $params  statements: `from`, `to`
     * @return array{view: view-string, filename: string, data: array<string, mixed>}
     */
    public function build(string $type, Company $company, string $id, array $params = []): array
    {
        $this->formats = CompanyFormats::for($company);
        $common = $this->common($company);
        $built = match ($type) {
            'invoice', 'credit_note', 'bill', 'debit_note' => $this->trade($type, $this->find(Invoice::class, $company, $id), $company),
            'receipt', 'payment_advice' => $this->settlement($type, $this->find(Settlement::class, $company, $id), $company),
            'purchase_order' => $this->purchaseOrder($this->find(PurchaseOrder::class, $company, $id), $company),
            'journal_voucher' => $this->journal($this->find(Journal::class, $company, $id), $company),
            'wht_certificate' => $this->certificate($this->find(WhtCertificate::class, $company, $id), $company),
            'customer_statement', 'supplier_statement' => $this->statement($type, $this->find(Contact::class, $company, $id), $company, $params),
            default => throw new \InvalidArgumentException("Unknown document type {$type}."),
        };

        return [
            'view' => self::VIEWS[$type],
            'filename' => $built['filename'],
            'data' => $common + $built['data'] + ['type' => $type],
        ];
    }

    /** @return array<string, mixed> */
    private function common(Company $company): array
    {
        $look = $this->look->for($company->id);

        return [
            'accent' => $look['accent_color'],
            'footer' => $look['footer_text'],
            'logo' => $this->logos->dataUri($company),
            'company' => [
                'name' => $company->name, 'legal_name' => $company->getAttribute('legal_name'),
                'tax_id' => $company->getAttribute('tax_id'), 'address' => self::addressLines($company->address),
            ],
            'generated' => $this->date(now()),
        ];
    }

    /**
     * @template T of \App\Models\BaseModel
     *
     * @param  class-string<T>  $class
     * @return T
     */
    private function find(string $class, Company $company, string $id)
    {
        return $class::query()->where('company_id', $company->id)->whereKey($id)->first()
            ?? throw DomainRuleViolation::single('not_found', 'The resource does not exist.');
    }

    // ---- sales and purchase documents ----------------------------------------------------------------------------

    /** @return array{filename: string, data: array<string, mixed>} */
    private function trade(string $type, Invoice $doc, Company $company): array
    {
        $money = $this->money($doc->currency);
        $sales = $doc->kind->isSales();
        $contact = Contact::query()->findOrFail($doc->contact_id);
        $lines = $doc->lines()->get();
        $items = Item::query()->whereIn('id', $lines->pluck('item_id')->filter()->all())->pluck('name', 'id');
        $accounts = Account::query()->whereIn('id', $lines->pluck('account_id')->all())->pluck('name', 'id');
        $date = self::dateOf($doc->issue_date);

        $rows = [];
        foreach ($lines as $line) {
            $label = $line->description ?? ($line->item_id !== null ? ($items[$line->item_id] ?? null) : null) ?? ($accounts[$line->account_id] ?? '');
            $rows[] = [
                'no' => $line->line_no,
                'description' => (string) $label,
                'quantity' => Percent::trim((string) $line->quantity),
                'unit_price' => $money->plain($line->unit_price_fc),
                'discount' => in_array(Percent::trim((string) $line->discount_pct), ['', '0'], true) ? '' : Percent::trim((string) $line->discount_pct).'%',
                'tax' => $line->tax_code_id === null ? '' : $this->taxLabel($line->tax_code_id, $date),
                'amount' => $money->plain($line->line_total_fc),
            ];
        }

        $totals = [['Subtotal', $money->plain($doc->subtotal_fc), '']];
        $totals[] = ['Tax', $money->plain($doc->tax_total_fc), ''];
        $totals[] = ['Total '.$doc->currency, $money->plain($doc->total_fc), 'strong'];
        if ($doc->wht_amount_fc > 0) {
            $totals[] = ['Less withholding tax', '-'.$money->plain($doc->wht_amount_fc), ''];
        }
        $posted = $doc->status->value === 'posted';
        if ($doc->settled_fc > 0) {
            $totals[] = [$doc->kind->isNote() ? 'Applied' : 'Paid', '-'.$money->plain($doc->settled_fc), ''];
        }
        if ($posted) {
            $totals[] = [$doc->kind->isNote() ? 'Credit remaining' : 'Balance due', $money->withCode($doc->amountDueFc()), 'due'];
        }

        $meta = [[$doc->kind->isNote() ? 'Date' : 'Issue date', $this->date($doc->issue_date)]];
        if (! $doc->kind->isNote()) {
            $meta[] = ['Due date', $this->date($doc->due_date)];
            $meta[] = ['Terms', $contact->payment_terms_days > 0 ? "Net {$contact->payment_terms_days} days" : 'Due on receipt'];
        }
        if ($doc->reference !== null && $doc->reference !== '') {
            $meta[] = [$sales ? 'Reference' : 'Supplier reference', $doc->reference];
        }
        if ($doc->related_invoice_id !== null) {
            $related = Invoice::query()->whereKey($doc->related_invoice_id)->value('number');
            if (is_string($related)) {
                $meta[] = [$sales ? 'Against invoice' : 'Against bill', $related];
            }
        }
        $meta[] = ['Currency', $doc->currency];
        if ($doc->currency !== $company->base_currency) {
            $meta[] = ['Exchange rate', '1 '.$doc->currency.' = '.rtrim(rtrim((string) $doc->fx_rate, '0'), '.').' '.$company->base_currency];
        }

        $titles = ['invoice' => 'Invoice', 'credit_note' => 'Credit note', 'bill' => 'Bill', 'debit_note' => 'Debit note'];
        $baseMoney = $this->money($company->base_currency);

        return [
            'filename' => $this->filename($titles[$type], $doc->number ?? 'draft'),
            'data' => [
                'title' => $titles[$type], 'number' => $doc->number, 'watermark' => self::watermark($doc->status->value),
                'party' => $this->party($contact, $sales ? 'Bill to' : 'Supplier'),
                'meta' => $meta, 'lines' => $rows,
                'tax_rows' => $this->taxBreakdown($lines, $doc->currency, $date, $money),
                'totals' => $totals,
                'words' => $posted || $doc->status->value === 'reversed' ? $money->words($doc->total_fc) : null,
                'base_total' => $doc->currency !== $company->base_currency ? $baseMoney->withCode($doc->total) : null,
                'memo' => $doc->memo,
                'payment_instructions' => $sales && ! $doc->kind->isNote() ? $this->look->for($company->id)['payment_instructions'] : '',
                'is_purchase' => ! $sales,
            ],
        ];
    }

    /**
     * Tax per code and rate: the taxable amount and the tax of every line that carries it. A tax group's share of a line
     * is stored per component code on the line, so each component is listed.
     *
     * @param  iterable<InvoiceLine|PurchaseOrderLine>  $lines
     * @return list<array{label: string, taxable: string, tax: string}>
     */
    private function taxBreakdown(iterable $lines, string $currency, string $date, DocMoney $money): array
    {
        $by = [];
        foreach ($lines as $line) {
            $detail = $line->tax_detail;
            if ($detail === [] && $line->tax_code_id !== null) {
                $detail = [$line->tax_code_id => $line->tax_amount_fc];
            }
            foreach ($detail as $codeId => $share) {
                $by[$codeId]['taxable'] = ($by[$codeId]['taxable'] ?? 0) + $line->line_total_fc;
                $by[$codeId]['tax'] = ($by[$codeId]['tax'] ?? 0) + $share;
            }
        }
        $out = [];
        foreach ($by as $codeId => $sum) {
            $out[] = ['label' => $this->taxLabel((string) $codeId, $date), 'taxable' => $money->plain($sum['taxable']), 'tax' => $money->plain($sum['tax'])];
        }

        return $out;
    }

    private function taxLabel(string $codeId, string $date): string
    {
        $code = TaxCode::query()->whereKey($codeId)->first();
        if ($code === null) {
            $group = TaxGroup::query()->whereKey($codeId)->first();

            return $group === null ? '' : $group->name;
        }
        $rate = TaxRate::query()->where('tax_code_id', $codeId)->where('effective_from', '<=', $date)
            ->where(fn ($q) => $q->whereNull('effective_to')->orWhere('effective_to', '>=', $date))->orderByDesc('effective_from')->first();

        return $code->name.($rate === null ? '' : ' '.Percent::ofFraction((string) $rate->rate));
    }

    // ---- settlements ----------------------------------------------------------------------------------------------

    /** @return array{filename: string, data: array<string, mixed>} */
    private function settlement(string $type, Settlement $s, Company $company): array
    {
        $money = $this->money($s->currency);
        $contact = Contact::query()->findOrFail($s->contact_id);
        $allocations = $s->allocations()->get();
        $docs = Invoice::query()->whereIn('id', $allocations->pluck('invoice_id')->filter()->all())->get()->keyBy('id');
        $rows = [];
        foreach ($allocations as $a) {
            $doc = $a->invoice_id === null ? null : $docs->get($a->invoice_id);
            $rows[] = [
                'document' => $doc === null ? 'Credit on account' : ucfirst($doc->kind->label()).' '.($doc->number ?? ''),
                'date' => $doc === null ? '' : $this->date($doc->issue_date),
                'reference' => (string) ($doc->reference ?? ''),
                'amount' => $money->plain($a->amount_fc),
            ];
        }
        $bank = $s->bank_account_id === null ? null : BankAccount::query()->whereKey($s->bank_account_id)->first();
        $method = $bank->name ?? Account::query()->whereKey($s->cash_account_id)->value('name');
        $kindTitle = ['receipt' => 'Receipt', 'supplier_refund' => 'Refund receipt', 'payment' => 'Payment advice', 'refund' => 'Refund advice'][$s->kind] ?? 'Receipt';
        $in = $s->isCashIn();
        $meta = [[$in ? 'Received on' : 'Paid on', $this->date($s->settlement_date)], [$in ? 'Received into' : 'Paid from', (string) $method]];
        if ($s->reference !== null && $s->reference !== '') {
            $meta[] = ['Reference', $s->reference];
        }
        $meta[] = ['Currency', $s->currency];
        if ($s->currency !== $company->base_currency) {
            $meta[] = ['Exchange rate', '1 '.$s->currency.' = '.rtrim(rtrim((string) $s->fx_rate, '0'), '.').' '.$company->base_currency];
        }
        $totals = [[$in ? 'Amount received' : 'Amount paid', $money->withCode($s->amount_fc), 'strong']];
        if ($s->unallocated_fc > 0) {
            $totals[] = ['Held as credit on account', $money->plain($s->unallocated_fc), ''];
        }

        return [
            'filename' => $this->filename($kindTitle, $s->number ?? 'draft'),
            'data' => [
                'title' => $kindTitle, 'number' => $s->number, 'watermark' => self::watermark($s->status->value),
                'party' => $this->party($contact, $in ? 'Received from' : 'Paid to'),
                'meta' => $meta, 'allocations' => $rows, 'totals' => $totals,
                'words' => in_array($s->status->value, ['posted', 'reversed'], true) ? $money->words($s->amount_fc) : null,
                'memo' => $s->memo, 'is_advice' => ! $in,
            ],
        ];
    }

    // ---- purchase order -------------------------------------------------------------------------------------------

    /** @return array{filename: string, data: array<string, mixed>} */
    private function purchaseOrder(PurchaseOrder $po, Company $company): array
    {
        $money = $this->money($po->currency);
        $contact = Contact::query()->findOrFail($po->contact_id);
        $lines = $po->lines()->get();
        $items = Item::query()->whereIn('id', $lines->pluck('item_id')->filter()->all())->pluck('name', 'id');
        $accounts = Account::query()->whereIn('id', $lines->pluck('account_id')->all())->pluck('name', 'id');
        $date = self::dateOf($po->order_date);
        $rows = [];
        foreach ($lines as $line) {
            $rows[] = [
                'no' => $line->line_no,
                'description' => (string) ($line->description ?? ($line->item_id !== null ? ($items[$line->item_id] ?? null) : null) ?? ($accounts[$line->account_id] ?? '')),
                'quantity' => Percent::trim((string) $line->quantity), 'unit_price' => $money->plain($line->unit_price_fc), 'discount' => '',
                'tax' => $line->tax_code_id === null ? '' : $this->taxLabel($line->tax_code_id, $date),
                'amount' => $money->plain($line->line_total_fc),
            ];
        }
        $meta = [['Order date', $this->date($po->order_date)]];
        if ($po->expected_date !== null) {
            $meta[] = ['Expected delivery', $this->date($po->expected_date)];
        }
        if ($po->reference !== null && $po->reference !== '') {
            $meta[] = ['Reference', $po->reference];
        }
        $meta[] = ['Currency', $po->currency];
        $status = $po->status->value;
        $watermark = match ($status) {
            'draft' => 'DRAFT', 'pending_approval' => 'PENDING APPROVAL', 'cancelled' => 'CANCELLED', default => null,
        };

        return [
            'filename' => $this->filename('Purchase order', $po->number ?? 'draft'),
            'data' => [
                'title' => 'Purchase order', 'number' => $po->number, 'watermark' => $watermark,
                'party' => $this->party($contact, 'Supplier'), 'meta' => $meta, 'lines' => $rows,
                'tax_rows' => $this->taxBreakdown($lines, $po->currency, $date, $money),
                'totals' => [['Subtotal', $money->plain($po->subtotal_fc), ''], ['Tax', $money->plain($po->tax_total_fc), ''], ['Total '.$po->currency, $money->withCode($po->total_fc), 'due']],
                'words' => null, 'memo' => $po->memo, 'revision' => $po->revision,
            ],
        ];
    }

    // ---- journal voucher ------------------------------------------------------------------------------------------

    /** @return array{filename: string, data: array<string, mixed>} */
    private function journal(Journal $j, Company $company): array
    {
        $money = $this->money($company->base_currency);
        $lines = $j->lines()->get();
        $accounts = Account::query()->whereIn('id', $lines->pluck('account_id')->all())->get()->keyBy('id');
        $rows = [];
        foreach ($lines as $line) {
            $account = $accounts->get($line->account_id);
            $rows[] = [
                'no' => $line->line_no, 'account' => $account === null ? '' : $account->code.' '.$account->name,
                'description' => (string) ($line->description ?? ''),
                'debit' => $line->debit > 0 ? $money->plain($line->debit) : '', 'credit' => $line->credit > 0 ? $money->plain($line->credit) : '',
            ];
        }
        $names = User::query()->whereIn('id', array_filter([$j->created_by, $j->approved_by, $j->posted_by]))->pluck('name', 'id');
        $meta = [['Journal date', $this->date($j->journal_date)], ['Type', ucfirst($j->journal_type->value)]];
        if ($j->reference !== null && $j->reference !== '') {
            $meta[] = ['Reference', $j->reference];
        }
        $meta[] = ['Currency', $company->base_currency];

        return [
            'filename' => $this->filename('Journal voucher', $j->number ?? 'draft'),
            'data' => [
                'title' => 'Journal voucher', 'number' => $j->number, 'watermark' => self::watermark($j->status->value),
                'meta' => $meta, 'journal_lines' => $rows,
                'total_debit' => $money->plain($j->total_debit), 'total_credit' => $money->plain($j->total_credit),
                'memo' => $j->memo,
                'signatures' => [
                    ['Prepared by', (string) ($j->created_by === null ? '' : ($names[$j->created_by] ?? ''))],
                    ['Approved by', (string) ($j->approved_by === null ? '' : ($names[$j->approved_by] ?? ''))],
                    ['Posted by', (string) ($j->posted_by === null ? '' : ($names[$j->posted_by] ?? '')).($j->posted_at === null ? '' : ' · '.$this->date($j->posted_at))],
                ],
            ],
        ];
    }

    // ---- withholding certificate -------------------------------------------------------------------------------

    /** @return array{filename: string, data: array<string, mixed>} */
    private function certificate(WhtCertificate $c, Company $company): array
    {
        $money = $this->money($company->base_currency);
        $contact = Contact::query()->findOrFail($c->contact_id);
        $code = TaxCode::query()->whereKey($c->tax_code_id)->first();
        $payment = Settlement::query()->whereKey($c->payment_id)->first();
        $bill = Invoice::query()->whereKey($c->invoice_id)->first();
        $date = self::dateOf($c->issued_on);
        $rate = $code === null ? null : TaxRate::query()->where('tax_code_id', $code->id)->where('effective_from', '<=', $date)
            ->where(fn ($q) => $q->whereNull('effective_to')->orWhere('effective_to', '>=', $date))->orderByDesc('effective_from')->first();

        return [
            'filename' => $this->filename('Withholding certificate', $c->number),
            'data' => [
                'title' => 'Withholding tax certificate', 'number' => $c->number, 'watermark' => $c->status === 'void' ? 'VOID' : null,
                'party' => $this->party($contact, 'Paid to (withholdee)'),
                'meta' => [['Issued on', $this->date($c->issued_on)], ['Payment', $payment->number ?? ''], ['Bill', $bill->number ?? '']],
                'tax_name' => $code === null ? '' : $code->name.($rate === null || str_contains($code->name, Percent::ofFraction((string) $rate->rate)) ? '' : ' '.Percent::ofFraction((string) $rate->rate)),
                'base' => $money->withCode($c->base_amount), 'withheld' => $money->withCode($c->wht_amount),
                'words' => $money->words($c->wht_amount),
            ],
        ];
    }

    // ---- statements -----------------------------------------------------------------------------------------------

    /**
     * @param  array<string, mixed>  $params
     * @return array{filename: string, data: array<string, mixed>}
     */
    private function statement(string $type, Contact $contact, Company $company, array $params): array
    {
        $customer = $type === 'customer_statement';
        $report = ($this->statements)($customer ? 'customer-statement' : 'supplier-statement', $company, [
            'contact_id' => $contact->id, 'from' => (string) ($params['from'] ?? ''), 'to' => (string) ($params['to'] ?? ''),
        ]);
        $money = $this->money($company->base_currency);
        $rows = [];
        foreach ((array) $report['rows'] as $r) {
            $rows[] = [
                'date' => $this->date(new \DateTimeImmutable((string) $r['date'])),
                'type' => str_replace('_', ' ', (string) $r['type']),
                'number' => (string) ($r['document']['number'] ?? $r['journal_number'] ?? ''),
                'description' => (string) ($r['description'] ?? ''),
                'debit' => $r['debit']['amount'] > 0 ? $money->plain($r['debit']['amount']) : '',
                'credit' => $r['credit']['amount'] > 0 ? $money->plain($r['credit']['amount']) : '',
                'balance' => $money->plain($r['balance']['amount']),
            ];
        }
        $from = new \DateTimeImmutable((string) $report['from']);
        $to = new \DateTimeImmutable((string) $report['to']);

        return [
            'filename' => $this->filename('Statement', Contact::query()->whereKey($contact->id)->value('code').'-'.$to->format('Ymd')),
            'data' => [
                'title' => 'Statement of account', 'number' => null, 'watermark' => null,
                'party' => $this->party($contact, $customer ? 'Statement for' : 'Supplier'),
                'meta' => [['Period', $this->date($from).' to '.$this->date($to)], ['Currency', $company->base_currency]],
                'opening' => $money->plain($report['opening_balance']['amount']), 'statement_rows' => $rows,
                'total_debit' => $money->plain($report['totals']['debit']['amount']), 'total_credit' => $money->plain($report['totals']['credit']['amount']),
                'closing' => $money->withCode($report['closing_balance']['amount']),
                'closing_label' => $customer ? 'Balance owed to us' : 'Balance we owe',
                'debit_label' => $customer ? 'Charges' : 'Paid / credited', 'credit_label' => $customer ? 'Paid / credited' : 'Charges',
                'payment_instructions' => $customer ? $this->look->for($company->id)['payment_instructions'] : '',
            ],
        ];
    }

    // ---- helpers --------------------------------------------------------------------------------------------------

    /** @return array{label: string, name: string, legal_name: string|null, tax_id: string|null, address: list<string>, email: string|null, phone: string|null} */
    private function party(Contact $c, string $label): array
    {
        return [
            'label' => $label, 'name' => $c->name, 'legal_name' => $c->legal_name !== $c->name ? $c->legal_name : null,
            'tax_id' => $c->tax_id, 'address' => self::addressLines($c->billing_address), 'email' => $c->email, 'phone' => $c->phone,
        ];
    }

    private function money(string $currency): DocMoney
    {
        $row = DB::selectOne('SELECT minor_unit FROM currencies WHERE code = ?', [$currency]);

        return new DocMoney($currency, $row === null ? 2 : (int) $row->minor_unit, $this->formats);
    }

    /** @return list<string> */
    public static function addressLines(mixed $address): array
    {
        if (! is_array($address)) {
            return [];
        }
        $out = [];
        foreach ($address as $part) {
            if (is_string($part) && trim($part) !== '') {
                $out[] = trim($part);
            }
        }

        return $out;
    }

    private static function watermark(string $status): ?string
    {
        return match ($status) {
            'draft' => 'DRAFT', 'pending_approval' => 'PENDING APPROVAL', 'void' => 'VOID', 'reversed' => 'REVERSED', default => null,
        };
    }

    private function filename(string $title, string $number): string
    {
        return preg_replace('/[^A-Za-z0-9._-]+/', '-', $title.'-'.$number).'.pdf';
    }

    /** A date in the company's own format (plan 3c.26b); the day-month-name form until the company is known. */
    private function date(?DateTimeInterface $date): string
    {
        return $date === null ? '' : ($this->formats ?? FormatPreferences::resolve(null, null, null))->date($date);
    }

    private static function dateOf(DateTimeInterface $date): string
    {
        return $date->format('Y-m-d');
    }
}
