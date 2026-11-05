<?php

declare(strict_types=1);

namespace App\Services\Trade;

use App\Contracts\Clock;
use App\Contracts\IdGenerator;
use App\Contracts\PermissionChecker;
use App\Domain\Shared\DomainRuleViolation;
use App\Domain\Shared\Violation;
use App\Domain\Trade\InvoiceKind;
use App\Domain\Trade\PostingSupport;
use App\Events\Transactions\TransactionEvent;
use App\Models\Organisation\Company;
use App\Models\Organisation\CompanySettings;
use App\Models\Trade\Contact;
use App\Models\Trade\Invoice;
use App\Queries\Fx\FindExchangeRate;
use App\Support\Actor;
use App\Support\ActorType;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\Warnings;
use Illuminate\Support\Facades\DB;

/**
 * The credit limit check at customer invoice submit (plan 3c.12), after the posting checks and under the invoice's lock, in the shape of
 * BillMatchGate. Per company: `off` (default), `warn` or `refuse` (`company_settings.credit_limit_mode`). The limit is the contact's
 * `credit_limit`, in the contact's currency; the exposure is in base: the contact's open invoices (total less tax withheld less settled,
 * posted ones only; unapplied credits are not netted, D9) plus this invoice. A limit in another currency is converted to base at the rate on
 * the invoice date; with no rate the check refuses rather than guess. The contact row is locked (after the invoice, by id) so two invoices
 * submitted together cannot both pass.
 *
 * `warn` adds a warning to the request and records it. `refuse` stops with `credit_limit_exceeded`; a person who holds
 * `invoices.override_credit_limit` and did not create or submit the invoice can submit again with a reason, which is audited.
 */
final class CreditLimitGate
{
    public function __construct(
        private readonly PermissionChecker $permissions,
        private readonly FindExchangeRate $rates,
        private readonly IdGenerator $ids,
        private readonly Clock $clock,
        private readonly Warnings $warnings,
    ) {}

    public function enforce(Actor $actor, LockSet $locks, AuditBuffer $audit, Outbox $outbox, Invoice $invoice, ?string $overrideReason): void
    {
        if ($invoice->kind !== InvoiceKind::SalesInvoice) {
            return;
        }
        $mode = (string) (CompanySettings::query()->where('company_id', $invoice->company_id)->value('credit_limit_mode') ?? 'off');
        if ($mode === 'off') {
            return;
        }
        $contact = Contact::query()->where('company_id', $invoice->company_id)->whereKey($invoice->contact_id)->first();
        if ($contact === null || $contact->credit_limit === null) {
            return;
        }
        $locks->document($contact);                                                                           // 2 (99), after the invoice

        $company = Company::query()->findOrFail($invoice->company_id);
        $limitBase = $this->limitInBase($company, $contact, $invoice);
        $open = (int) DB::table('invoices')->where('company_id', $invoice->company_id)->where('contact_id', $invoice->contact_id)
            ->where('kind', InvoiceKind::SalesInvoice->value)->where('status', 'posted')->where('id', '<>', $invoice->id)
            ->sum(DB::raw('GREATEST(total - wht_amount - settled, 0)'));
        $exposure = $open + ($invoice->total - $invoice->wht_amount);
        if ($exposure <= $limitBase) {
            return;
        }

        $message = sprintf(
            'This invoice brings %s to %s %s of receivables, over the credit limit of %s %s.',
            $contact->name, $company->base_currency, $this->fmt($exposure), $company->base_currency, $this->fmt($limitBase),
        );
        if ($mode === 'warn') {
            $this->warnings->add('credit_limit_exceeded', $message);
            $this->record($actor, $invoice, 'warned', $exposure, $limitBase, null);

            return;
        }

        $reason = trim((string) $overrideReason);
        if ($reason === '') {
            throw new DomainRuleViolation('credit_limit_exceeded', $message, [new Violation('credit_limit_exceeded', $message)]);
        }
        if ($actor->type !== ActorType::User || ! $this->permissions->allows($actor, 'invoices.override_credit_limit', $invoice->company_id)) {
            throw DomainRuleViolation::single('credit_limit_override_forbidden', 'You cannot override a credit limit.');
        }
        // Maker and checker differ: whoever created or submitted the invoice may not wave its limit through.
        if (in_array($actor->id, [$invoice->created_by, $invoice->submitted_by], true)) {
            throw DomainRuleViolation::single('credit_limit_override_self_forbidden', 'You made this invoice, so someone else has to override its credit limit.');
        }
        $this->record($actor, $invoice, 'overridden', $exposure, $limitBase, $reason);
        $audit->add('invoice.credit_limit_overridden', $invoice, after: $invoice, context: ['reason' => $reason, 'exposure' => $exposure, 'limit' => $limitBase]);
        $outbox->add(new TransactionEvent('invoice.credit_limit_overridden', $invoice->id, $invoice->company_id, $invoice->lock_version, ['reason' => $reason, 'exposure' => $exposure, 'limit' => $limitBase]));
    }

    private function limitInBase(Company $company, Contact $contact, Invoice $invoice): int
    {
        $limit = (int) $contact->credit_limit;
        if ($contact->default_currency === $company->base_currency) {
            return $limit;
        }
        $rate = $this->rates->require($company->id, $contact->default_currency, $company->base_currency, $invoice->issue_date->format('Y-m-d'))->rate;

        return PostingSupport::toBase($limit, $rate);
    }

    private function fmt(int $minor): string
    {
        return number_format($minor / 100, 2, '.', ',');
    }

    private function record(Actor $actor, Invoice $invoice, string $outcome, int $exposure, int $limit, ?string $reason): void
    {
        DB::table('credit_limit_checks')->insert([
            'id' => $this->ids->next(), 'tenant_id' => $actor->tenantId, 'company_id' => $invoice->company_id, 'invoice_id' => $invoice->id,
            'contact_id' => $invoice->contact_id, 'outcome' => $outcome, 'exposure' => $exposure, 'limit_base' => $limit, 'reason' => $reason,
            'decided_by' => $actor->id, 'created_at' => $this->clock->now(),
        ]);
    }
}
