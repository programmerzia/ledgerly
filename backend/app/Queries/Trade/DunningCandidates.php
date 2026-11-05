<?php

declare(strict_types=1);

namespace App\Queries\Trade;

use App\Domain\Documents\DunningRules;
use App\Domain\Trade\InvoiceKind;
use App\Domain\Workflow\DocumentStatus;
use App\Models\Organisation\Company;
use App\Models\Trade\Contact;
use App\Models\Trade\DunningStage;
use App\Models\Trade\Invoice;
use DateTimeImmutable;
use Illuminate\Support\Facades\DB;

/**
 * The overdue-invoice reminders due on a date (plan 3c.7), for the daily run and for the "due tomorrow" preview.
 * Only posted sales invoices with an open balance, never credit notes, drafts, voided or reversed ones, and never a contact
 * that opted out. A fully paid invoice, or one a later write-off (plan 3c.9) brings to a zero balance, has no balance and so
 * never appears. A contact with no email address is listed (the preview flags it) but cannot be sent to.
 */
final class DunningCandidates
{
    /**
     * @return list<array{invoice: Invoice, contact: Contact, stage: DunningStage, days_overdue: int, amount_due_fc: int, email: string|null}>
     */
    public function __invoke(Company $company, DateTimeImmutable $on): array
    {
        /** @var array<string, DunningStage> $stages */
        $stages = DunningStage::query()->where('company_id', $company->id)->orderBy('days_after_due')->get()->keyBy('id')->all();
        if ($stages === []) {
            return [];
        }
        $days = array_map(fn (DunningStage $s): int => $s->days_after_due, $stages);
        $earliest = $on->modify('-'.min($days).' days')->format('Y-m-d');

        $out = [];
        Invoice::query()->where('company_id', $company->id)->where('kind', InvoiceKind::SalesInvoice->value)->where('status', DocumentStatus::Posted->value)
            ->whereRaw('total_fc - wht_amount_fc - settled_fc > 0')->where('due_date', '<=', $earliest)
            ->whereIn('contact_id', Contact::query()->where('company_id', $company->id)->where('dunning_opt_out', false)->select('id'))
            ->chunkById(200, function ($invoices) use (&$out, $stages, $days, $on): void {
                $used = DB::table('dunning_sends')->whereIn('invoice_id', $invoices->pluck('id')->all())->get(['invoice_id', 'stage_id'])
                    ->groupBy('invoice_id')->map(fn ($rows) => array_values($rows->pluck('stage_id')->map(fn ($s) => (string) $s)->all()))->all();
                $contacts = Contact::query()->whereIn('id', $invoices->pluck('contact_id')->all())->get()->keyBy('id');
                foreach ($invoices as $invoice) {
                    /** @var Invoice $invoice */
                    $overdue = DunningRules::daysOverdue(DateTimeImmutable::createFromInterface($invoice->due_date), $on);
                    $stageId = DunningRules::due($overdue, $days, $used[$invoice->id] ?? []);
                    $contact = $contacts->get($invoice->contact_id);
                    if ($stageId === null || $contact === null) {
                        continue;
                    }
                    $email = $contact->email === null || trim($contact->email) === '' ? null : trim($contact->email);
                    $out[] = [
                        'invoice' => $invoice, 'contact' => $contact, 'stage' => $stages[$stageId], 'days_overdue' => $overdue,
                        'amount_due_fc' => $invoice->amountDueFc(), 'email' => $email,
                    ];
                }
            });

        return $out;
    }
}
