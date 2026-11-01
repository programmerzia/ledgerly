<?php

declare(strict_types=1);

namespace App\Actions\Trade;

use App\Contracts\Clock;
use App\Contracts\IdGenerator;
use App\Domain\Ledger\JournalType;
use App\Domain\Ledger\PostingRejected;
use App\Domain\Shared\DomainRuleViolation;
use App\Domain\Shared\Violation;
use App\Domain\Trade\PostingSupport;
use App\Domain\Workflow\DocumentStatus;
use App\Events\Trade\PaymentRunPosted;
use App\Models\Organisation\Company;
use App\Models\Trade\PaymentRun;
use App\Models\Trade\Settlement;
use App\Services\Ledger\PostingEngine;
use App\Services\Trade\SettlementPoster;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\RetryUnitOfWork;
use App\Support\UnitOfWork\UnitOfWork;
use DateTimeImmutable;
use Illuminate\Database\DatabaseManager;

/**
 * Posts an approved payment run: one payment per supplier, all in this one transaction (13 §8): period, then the run,
 * then the supplier payments are created and the bills locked by id, then every number in key order (payments, the
 * run, certificates, journals), one merged balance upsert. A bill that was paid since the run was drafted fails the
 * whole run (`allocation_exceeds_open_amount`); nothing partial is ever left. Called by SubmitDocument / ApproveDocument.
 */
final class PostPaymentRun
{
    public function __construct(
        private readonly UnitOfWork $uow,
        private readonly PostingEngine $engine,
        private readonly SettlementPoster $poster,
        private readonly IdGenerator $ids,
        private readonly Clock $clock,
        private readonly DatabaseManager $db,
    ) {}

    public function handle(Actor $actor, string $runId, ?int $lockVersion = null): PaymentRun
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $runId, $lockVersion) {
            $seen = PaymentRun::query()->findOrFail($runId);
            $date = DateTimeImmutable::createFromInterface($seen->run_date);
            $period = $this->engine->lockPeriod($locks, $seen->company_id, JournalType::Payment, $date, null);       // 1
            $run = $locks->document($seen, $lockVersion);                                                          // 2 (rank 15)

            if ($run->run_date->format('Y-m-d') !== $seen->run_date->format('Y-m-d')) {
                throw new RetryUnitOfWork('Run date changed while locking.');
            }
            if (! in_array($run->status, [DocumentStatus::Draft, DocumentStatus::PendingApproval], true)) {
                throw DomainRuleViolation::single('document_not_postable', "A {$run->status->value} payment run cannot be posted.");
            }
            if ($period === null) {
                throw PostingRejected::because([new Violation('period_missing', 'No fiscal period covers the run date.')]);
            }
            $items = $run->items()->get();
            if ($items->isEmpty()) {
                throw DomainRuleViolation::single('payment_run_empty', 'The run has no bills.');
            }
            $company = Company::query()->findOrFail($run->company_id);

            // One payment per supplier, created posted-ready (draft rows, flipped by the poster in this transaction).
            $now = $this->clock->now();
            $settlements = [];
            foreach ($items->groupBy('contact_id')->sortKeys() as $contactId => $group) {
                $net = (int) $group->sum('amount_fc');
                $s = new Settlement;
                $s->forceFill([
                    'id' => $this->ids->next(), 'tenant_id' => $actor->tenantId, 'company_id' => $run->company_id, 'kind' => 'payment',
                    'status' => DocumentStatus::Draft, 'contact_id' => (string) $contactId, 'cash_account_id' => $run->cash_account_id,
                    'bank_account_id' => $run->bank_account_id, 'settlement_date' => $run->run_date, 'currency' => $run->currency, 'fx_rate' => $run->fx_rate,
                    'amount_fc' => $net, 'amount' => PostingSupport::toBase($net, (string) $run->fx_rate), 'reference' => $run->reference, 'memo' => $run->memo,
                    'payment_run_id' => $run->id, 'created_by' => $run->created_by, 'submitted_by' => $run->submitted_by, 'approved_by' => $run->approved_by,
                    'lock_version' => 0,
                ])->save();
                $rows = [];
                foreach ($group as $item) {
                    $rows[] = [
                        'id' => $this->ids->next(), 'tenant_id' => $actor->tenantId, 'company_id' => $run->company_id, 'settlement_id' => $s->id,
                        'invoice_id' => $item->invoice_id, 'source_settlement_id' => null, 'amount_fc' => $item->amount_fc, 'amount' => 0, 'fx_gain_loss' => 0,
                        'created_at' => $now, 'updated_at' => $now,
                    ];
                }
                $this->db->connection()->table('settlement_allocations')->insert($rows);
                $s->load('allocations');
                $settlements[] = $s;
            }

            $invoices = $this->poster->lockInvoices($locks, $settlements);                                       // 2 (rank 30, by id)
            $number = null;
            $posted = $this->poster->post(
                $actor, $locks, $audit, $outbox, $settlements, $period, $company, $invoices, [], $run->id,
                function (string $year) use ($locks, $run, &$number): void {
                    $number = $locks->sequence($run->company_id, 'doc:payment_run:'.$year, 'RUN-'.$year.'-');   // 3
                },
            );

            $before = $run->attributesToArray();
            $run->forceFill([
                'status' => DocumentStatus::Posted, 'number' => $number, 'posted_at' => $now, 'posted_by' => $actor->id, 'lock_version' => $run->lock_version + 1,
            ])->save();
            $audit->add('payment_run.posted', $run, before: $before, after: $run, context: ['number' => $number, 'settlements' => count($posted)]);
            $outbox->add(new PaymentRunPosted($run->id, $run->company_id, $run->lock_version, [
                'number' => $number, 'settlement_ids' => array_map(fn (Settlement $s): string => $s->id, $posted),
            ]));

            return $run;
        });
    }
}
