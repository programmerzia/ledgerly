<?php

declare(strict_types=1);

namespace App\Services\Documents;

use App\Domain\Documents\DocMoney;
use App\Domain\Shared\DomainRuleViolation;
use App\Models\BaseModel;
use App\Models\Documents\DocumentSend;
use App\Models\Organisation\Company;
use App\Models\Trade\Contact;
use App\Models\Trade\Invoice;
use App\Models\Trade\Settlement;
use App\Queries\Reports\RunReport;
use DateTimeInterface;
use Illuminate\Support\Facades\DB;

/**
 * Decides whether a document may be emailed and what the placeholders in its message stand for. Sendable: posted
 * invoices and credit notes, statements, customer receipts and payment advices (payments to suppliers). Anything else, and anything that is
 * not posted, is refused with a plain sentence.
 */
final class EmailTargets
{
    public function __construct(private readonly DocumentLook $look, private readonly RunReport $statements) {}

    /**
     * @param  array<string, mixed>  $params  statement: from, to, side
     * @param  array<string, string>  $extraValues  more placeholder values from the caller
     */
    public function resolve(BaseModel $model, Company $company, array $params, string $senderName, array $extraValues = []): EmailTarget
    {
        [$family, $pdfType, $contact, $parameters, $values] = match (true) {
            $model instanceof Invoice => $this->invoice($model, $company),
            $model instanceof Settlement => $this->payment($model, $company),
            $model instanceof Contact => $this->statement($model, $company, $params),
            default => throw DomainRuleViolation::single('not_sendable', 'This kind of document cannot be sent by email.'),
        };
        $look = $this->look->for($company->id);

        return new EmailTarget($family, $pdfType, $model, $contact, $parameters, $values + [
            'company_name' => $company->name, 'contact_name' => $contact->name, 'sender_name' => $senderName,
            'payment_instructions' => $look['payment_instructions'],
        ] + $extraValues);
    }

    /** The document a stored send belongs to. */
    public function subjectOf(DocumentSend $send): ?BaseModel
    {
        $class = match ($send->document_type) {
            'invoice', 'credit_note' => Invoice::class,
            'payment_advice', 'receipt' => Settlement::class,
            'statement' => Contact::class,
            default => null,
        };

        return $class === null ? null : $class::query()->where('company_id', $send->company_id)->whereKey($send->document_id)->first();
    }

    /** @return array{0: string, 1: string, 2: Contact, 3: array<string, string>, 4: array<string, string>} */
    private function invoice(Invoice $doc, Company $company): array
    {
        if (! $doc->kind->isSales()) {
            throw DomainRuleViolation::single('not_sendable', 'Bills and debit notes are supplier documents and are not sent from here.');
        }
        $this->requirePosted($doc->status->value);
        $money = $this->money($doc->currency);
        $note = $doc->kind->isNote();

        return [
            $note ? 'credit_note' : 'invoice', $note ? 'credit_note' : 'invoice', $this->contact($doc->contact_id), [],
            [
                'document_number' => (string) $doc->number, 'document_type' => $note ? 'Credit note' : 'Invoice',
                'issue_date' => $this->date($doc->issue_date), 'due_date' => $this->date($doc->due_date),
                'total' => $money->withCode($doc->total_fc), 'amount_due' => $money->withCode($doc->amountDueFc()),
                // The draft keeps the placeholder as typed; the link is made when the mail is sent.
                'invoice_link' => $note ? '' : '{{ invoice_link }}',
            ],
        ];
    }

    /** @return array{0: string, 1: string, 2: Contact, 3: array<string, string>, 4: array<string, string>} */
    private function payment(Settlement $s, Company $company): array
    {
        if (! in_array($s->kind, ['payment', 'refund', 'receipt'], true)) {
            throw DomainRuleViolation::single('not_sendable', 'Only customer receipts and payment advices are sent from here.');
        }
        $this->requirePosted($s->status->value);
        $money = $this->money($s->currency);
        $receipt = $s->kind === 'receipt';
        $family = $receipt ? 'receipt' : 'payment_advice';

        return [
            $family, $family, $this->contact($s->contact_id), [],
            ['document_number' => (string) $s->number, 'document_type' => $receipt ? 'Receipt' : 'Payment advice', 'issue_date' => $this->date($s->settlement_date), 'total' => $money->withCode($s->amount_fc)],
        ];
    }

    /**
     * @param  array<string, mixed>  $params
     * @return array{0: string, 1: string, 2: Contact, 3: array<string, string>, 4: array<string, string>}
     */
    private function statement(Contact $contact, Company $company, array $params): array
    {
        if (! isset($params['from'], $params['to'])) {
            throw DomainRuleViolation::single('statement_period_required', 'Give the start and end date of the statement.');
        }
        $side = (string) ($params['side'] ?? ($contact->kind === 'both' ? '' : $contact->kind));
        if (! in_array($side, ['customer', 'supplier'], true)) {
            throw DomainRuleViolation::single('statement_side_required', 'This contact is both a customer and a supplier. Say which statement you want.');
        }
        if ($contact->kind !== 'both' && $contact->kind !== $side) {
            throw DomainRuleViolation::single('statement_side_invalid', "This contact is not a {$side}.");
        }
        $from = (string) $params['from'];
        $to = (string) $params['to'];
        $report = ($this->statements)($side.'-statement', $company, ['contact_id' => $contact->id, 'from' => $from, 'to' => $to]);
        $money = $this->money($company->base_currency);

        return [
            'statement', $side.'_statement', $contact, ['from' => $from, 'to' => $to, 'side' => $side],
            [
                'document_type' => 'Statement', 'period_from' => $this->date(new \DateTimeImmutable($from)), 'period_to' => $this->date(new \DateTimeImmutable($to)),
                'issue_date' => $this->date(new \DateTimeImmutable($to)), 'closing_balance' => $money->withCode((int) $report['closing_balance']['amount']),
            ],
        ];
    }

    private function requirePosted(string $status): void
    {
        if ($status !== 'posted') {
            throw DomainRuleViolation::single('document_not_posted', 'Only a posted document can be sent. Post it first, then send it.');
        }
    }

    private function contact(string $id): Contact
    {
        return Contact::query()->findOrFail($id);
    }

    private function money(string $currency): DocMoney
    {
        $row = DB::selectOne('SELECT minor_unit FROM currencies WHERE code = ?', [$currency]);

        return new DocMoney($currency, $row === null ? 2 : (int) $row->minor_unit);
    }

    private function date(DateTimeInterface $date): string
    {
        return $date->format('d M Y');
    }
}
