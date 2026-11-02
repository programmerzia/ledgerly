<?php

declare(strict_types=1);

namespace App\Services\Trade;

use App\Contracts\Clock;
use App\Contracts\IdGenerator;
use App\Domain\Ledger\BalanceDelta;
use App\Domain\Shared\DomainRuleViolation;
use App\Domain\Workflow\DocumentStatus;
use App\Events\Trade\SettlementPosted;
use App\Models\Fiscal\FiscalPeriod;
use App\Models\Organisation\Company;
use App\Models\Trade\Invoice;
use App\Models\Trade\Settlement;
use App\Models\Trade\WhtCertificate;
use App\Services\Ledger\PostingEngine;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use Illuminate\Database\DatabaseManager;

/**
 * Posts one or more settlements in the caller's UnitOfWork (13 §8): the caller has locked the period and the
 * settlements; this locks the invoices they settle (sorted by id), re-checks every allocation against the locked
 * rows (D4, D9: open amount, contact, currency), allocates all numbers in key order (settlements, certificates, then
 * journals), writes the journals with one merged balance upsert, and only then moves `settled`/`unallocated` and
 * flips the status, so the sub-ledger and the ledger change in the same transaction or not at all.
 *
 * WHT: the tax on a bill is withheld when the bill posts (BillPosting), so a payment settles the net and never
 * withholds again. A payment that settles a bill carrying WHT issues a certificate for the withheld share it covers
 * (pro rata to the carried amount; the payment that clears the bill takes the remainder).
 */
final class SettlementPoster
{
    public function __construct(
        private readonly SettlementPlanner $planner,
        private readonly DraftMapper $mapper,
        private readonly PostingEngine $engine,
        private readonly IdGenerator $ids,
        private readonly Clock $clock,
        private readonly DatabaseManager $db,
        private readonly WhtCertificateShares $wht,
    ) {}

    /**
     * Level 2, after the settlements: the invoices (sorted by id) and the settlements whose credit is refunded.
     * The sources must already be locked by the caller (they are settlements).
     *
     * @param  list<Settlement>  $settlements
     * @param  array<string, Settlement>  $lockedSources
     * @return array<string, Invoice>
     */
    public function lockInvoices(LockSet $locks, array $settlements, array $lockedSources = []): array
    {
        $ids = [];
        foreach ($settlements as $s) {
            foreach ($s->allocations as $a) {
                if ($a->invoice_id !== null) {
                    $ids[$a->invoice_id] = true;
                }
            }
        }
        $ids = array_keys($ids);
        sort($ids, SORT_STRING);
        $invoices = [];
        foreach ($ids as $id) {
            $row = Invoice::query()->whereKey($id)->first();
            if ($row === null) {
                throw DomainRuleViolation::single('allocation_target_invalid', 'An allocated document does not exist.');
            }
            $invoices[$id] = $locks->document($row);
        }

        return $invoices;
    }

    /**
     * @param  list<Settlement>  $settlements  locked; status draft or pending approval; allocations loaded
     * @param  array<string, Invoice>  $invoices  locked
     * @param  array<string, Settlement>  $sources  locked
     * @return list<Settlement> the posted settlements
     */
    public function post(
        Actor $actor, LockSet $locks, AuditBuffer $audit, Outbox $outbox, array $settlements, FiscalPeriod $period,
        Company $company, array $invoices, array $sources, ?string $runId = null, ?\Closure $afterSettlementNumbers = null,
    ): array {
        $year = $period->fiscalYear()->firstOrFail()->name;

        // 1. Plan everything first (pure, refuses before any number is taken).
        $plans = [];
        foreach ($settlements as $s) {
            $plans[$s->id] = $this->planner->plan($s, $company, $invoices, $sources, $s->number ?? 'Draft');
        }

        // 2. Numbers, in key order: settlements, certificates, journals (level 3).
        $order = $settlements;
        usort($order, fn (Settlement $a, Settlement $b): int => [$a->kind, $a->id] <=> [$b->kind, $b->id]);
        $numbers = [];
        foreach ($order as $s) {
            $numbers[$s->id] = $s->number ?? $locks->sequence($company->id, 'doc:'.$s->kind.':'.$year, self::prefix($s->kind).'-'.$year.'-');
        }
        if ($afterSettlementNumbers !== null) {
            $afterSettlementNumbers($year); // a payment run takes its own number here, between the payments' and the certificates' keys
        }
        $certificates = [];
        foreach ($order as $s) {
            foreach ($s->kind === 'payment' ? $this->certificateShares($plans[$s->id], $invoices) : [] as $share) {
                $certificates[] = [...$share, 'settlement' => $s, 'number' => $locks->sequence($company->id, 'doc:wht_certificate:'.$year, 'WHT-'.$year.'-')];
            }
        }

        // 3. Journals: re-plan with the real numbers so the references read right, validate, write.
        $deltas = [];
        $journals = [];
        foreach ($order as $s) {
            $plan = $this->planner->plan($s, $company, $invoices, $sources, $numbers[$s->id]);
            $draft = $this->mapper->toDraft($company->id, $plan->proposed, $company->base_currency);
            $ctx = $this->engine->context($actor, $draft, $period);
            $decided = $this->engine->decide($draft, $ctx, $period);
            [$key, $prefix] = $this->engine->sequenceFor($period);
            $number = $locks->sequence($company->id, $key, $prefix);
            $journal = $this->engine->insertDraft($actor, $this->ids->next(), $draft, $company->base_currency, $period->id);
            $journals[$s->id] = $this->engine->markPosted($journal, $decided, $number, $period, $actor);
            foreach ($decided->balanceDeltas as $d) {
                $k = $d->accountId.'|'.bin2hex($d->dimKey());
                $deltas[$k] = isset($deltas[$k])
                    ? new BalanceDelta($d->accountId, $d->dims, $deltas[$k]->debit + $d->debit, $deltas[$k]->credit + $d->credit)
                    : $d;
            }
            $plans[$s->id] = $plan;
        }
        $locks->balances($company->id, $period->id, array_values($deltas));

        // 4. The sub-ledger, in the same transaction.
        $now = $this->clock->now();
        $conn = $this->db->connection();
        $invoiceDelta = [];
        $sourceDelta = [];
        $posted = [];
        foreach ($order as $s) {
            $plan = $plans[$s->id];
            foreach ($plan->allocations as $a) {
                $conn->table('settlement_allocations')->where('id', $a['id'])->update(['amount' => $a['amount'], 'fx_gain_loss' => $a['fx_gain_loss'], 'updated_at' => $now]);
                if ($a['invoice_id'] !== null) {
                    $invoiceDelta[$a['invoice_id']] = [($invoiceDelta[$a['invoice_id']][0] ?? 0) + $a['amount_fc'], ($invoiceDelta[$a['invoice_id']][1] ?? 0) + $a['amount']];
                } else {
                    $sourceDelta[(string) $a['source_id']] = [($sourceDelta[(string) $a['source_id']][0] ?? 0) + $a['amount_fc'], ($sourceDelta[(string) $a['source_id']][1] ?? 0) + $a['amount']];
                }
            }
        }
        foreach ($invoiceDelta as $id => [$fc, $base]) {
            $inv = $invoices[$id];
            $inv->forceFill(['settled_fc' => $inv->settled_fc + $fc, 'settled' => $inv->settled + $base, 'lock_version' => $inv->lock_version + 1])->save();
        }
        foreach ($sourceDelta as $id => [$fc, $base]) {
            $src = $sources[$id];
            $src->forceFill(['unallocated_fc' => $src->unallocated_fc - $fc, 'unallocated' => $src->unallocated - $base, 'lock_version' => $src->lock_version + 1])->save();
        }
        foreach ($certificates as $c) {
            (new WhtCertificate)->forceFill([
                'id' => $this->ids->next(), 'tenant_id' => $actor->tenantId, 'company_id' => $company->id, 'number' => $c['number'],
                'payment_id' => $c['settlement']->id, 'invoice_id' => $c['invoice_id'], 'contact_id' => $c['settlement']->contact_id,
                'tax_code_id' => $c['tax_code_id'], 'base_amount' => $c['base'], 'wht_amount' => $c['wht'],
                'issued_on' => $c['settlement']->settlement_date, 'status' => 'issued',
            ])->save();
        }
        foreach ($order as $s) {
            $plan = $plans[$s->id];
            $before = $s->attributesToArray();
            $s->forceFill([
                'status' => DocumentStatus::Posted, 'number' => $numbers[$s->id], 'journal_id' => $journals[$s->id]->id,
                'unallocated_fc' => $plan->unallocatedFc, 'unallocated' => $plan->unallocated,
                'payment_run_id' => $runId ?? $s->payment_run_id,
                'posted_at' => $now, 'posted_by' => $actor->id, 'lock_version' => $s->lock_version + 1,
            ])->save();
            $audit->add('settlement.posted', $s, before: $before, after: $s, context: [
                'kind' => $s->kind, 'journal_id' => $journals[$s->id]->id, 'number' => $numbers[$s->id], 'allocations' => count($plan->allocations),
            ]);
            $outbox->add(new SettlementPosted($s->id, $s->company_id, $s->lock_version, [
                'kind' => $s->kind, 'number' => $numbers[$s->id], 'posting_journal_id' => $journals[$s->id]->id,
            ]));
            $posted[] = $s;
        }

        return $posted;
    }

    public static function prefix(string $kind): string
    {
        return match ($kind) {
            'receipt' => 'RCT', 'payment' => 'PAY', 'refund' => 'CRF', default => 'SRF',
        };
    }

    /**
     * WHT certificate shares of a payment: per bill with withheld tax, the part of it this payment covers.
     *
     * @param  array<string, Invoice>  $invoices
     * @return list<array{invoice_id: string, tax_code_id: string, base: int, wht: int}>
     */
    private function certificateShares(SettlementPlan $plan, array $invoices): array
    {
        $out = [];
        foreach ($plan->allocations as $a) {
            $share = $a['invoice_id'] === null ? null : $this->wht->of($invoices[$a['invoice_id']], $a['amount_fc'], $a['amount']);
            if ($share !== null) {
                $out[] = $share;
            }
        }

        return $out;
    }
}
