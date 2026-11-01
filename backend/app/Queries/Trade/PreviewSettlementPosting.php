<?php

declare(strict_types=1);

namespace App\Queries\Trade;

use App\Domain\Ledger\DraftLine;
use App\Domain\Ledger\PostingRejected;
use App\Domain\Ledger\PostingValidator;
use App\Domain\Shared\DomainRuleViolation;
use App\Domain\Shared\Violation;
use App\Domain\Trade\PostingSupport;
use App\Domain\Workflow\DocumentStatus;
use App\Models\Fiscal\FiscalPeriod;
use App\Models\Organisation\Company;
use App\Models\Trade\PaymentRun;
use App\Models\Trade\Settlement;
use App\Models\Trade\SettlementAllocation;
use App\Services\Ledger\PostingEngine;
use App\Services\Trade\DraftMapper;
use App\Services\Trade\SettlementPlanner;
use App\Services\Trade\SettlementWriter;
use App\Support\Actor;
use Illuminate\Database\Eloquent\Collection;

/**
 * The journal a settlement (or, per supplier, a payment run) would post and the posting validator's verdict, without
 * locks or side effects: the same planner and rules as the posting itself (13 §9). Numbers are never predicted.
 */
final class PreviewSettlementPosting
{
    public function __construct(
        private readonly PostingEngine $engine,
        private readonly PostingValidator $validator,
        private readonly SettlementPlanner $planner,
        private readonly SettlementWriter $writer,
        private readonly DraftMapper $mapper,
    ) {}

    public function of(Actor $actor, string $settlementId): InvoicePostingPreview
    {
        $s = Settlement::query()->with('allocations')->findOrFail($settlementId);
        $violations = [];
        if (! in_array($s->status, [DocumentStatus::Draft, DocumentStatus::PendingApproval], true)) {
            $violations[] = new Violation('document_not_postable', "A {$s->status->value} settlement cannot be posted.");
        }

        return $this->run($actor, $s->company_id, $s->settlement_date->format('Y-m-d'), [$s], $violations);
    }

    public function ofRun(Actor $actor, string $runId): InvoicePostingPreview
    {
        $run = PaymentRun::query()->with('items')->findOrFail($runId);
        $violations = [];
        if (! in_array($run->status, [DocumentStatus::Draft, DocumentStatus::PendingApproval], true)) {
            $violations[] = new Violation('document_not_postable', "A {$run->status->value} payment run cannot be posted.");
        }
        $settlements = [];
        foreach ($run->items->groupBy('contact_id')->sortKeys() as $contactId => $group) {
            $net = (int) $group->sum('amount_fc');
            $s = new Settlement;
            $s->forceFill([
                'id' => 'run-'.$contactId, 'company_id' => $run->company_id, 'kind' => 'payment', 'status' => DocumentStatus::Draft,
                'contact_id' => (string) $contactId, 'cash_account_id' => $run->cash_account_id, 'settlement_date' => $run->run_date,
                'currency' => $run->currency, 'fx_rate' => $run->fx_rate, 'amount_fc' => $net,
                'amount' => PostingSupport::toBase($net, (string) $run->fx_rate), 'reference' => $run->reference, 'memo' => $run->memo,
            ]);
            $s->setRelation('allocations', new Collection($group->map(function ($item): SettlementAllocation {
                $a = new SettlementAllocation;
                $a->forceFill(['id' => 'item-'.$item->id, 'invoice_id' => $item->invoice_id, 'source_settlement_id' => null, 'amount_fc' => $item->amount_fc]);

                return $a;
            })->all()));
            $settlements[] = $s;
        }

        return $this->run($actor, $run->company_id, $run->run_date->format('Y-m-d'), $settlements, $violations);
    }

    /**
     * @param  list<Settlement>  $settlements
     * @param  list<Violation>  $violations
     */
    private function run(Actor $actor, string $companyId, string $date, array $settlements, array $violations): InvoicePostingPreview
    {
        $period = FiscalPeriod::query()->where('company_id', $companyId)->where('kind', 'regular')
            ->where('starts_on', '<=', $date)->where('ends_on', '>=', $date)->first();
        if ($period === null) {
            $violations[] = new Violation('period_missing', 'No fiscal period covers the date.');
        }
        $company = Company::query()->findOrFail($companyId);
        $lines = [];
        $debit = 0;
        $credit = 0;
        foreach ($settlements as $s) {
            try {
                [$invoices, $sources] = $this->writer->targets($s);
                $plan = $this->planner->plan($s, $company, $invoices, $sources, $s->number ?? 'Draft');
                $draft = $this->mapper->toDraft($companyId, $plan->proposed, $company->base_currency);
                array_push($lines, ...$draft->lines);
                if ($period !== null) {
                    try {
                        $decided = $this->validator->validate($draft, $this->engine->context($actor, $draft, $period));
                        $debit += $decided->totalDebit;
                        $credit += $decided->totalCredit;
                    } catch (PostingRejected $e) {
                        array_push($violations, ...$e->violations);
                        $debit += (int) array_sum(array_map(fn (DraftLine $l): int => $l->debit, $draft->lines));
                        $credit += (int) array_sum(array_map(fn (DraftLine $l): int => $l->credit, $draft->lines));
                    }
                }
            } catch (DomainRuleViolation $e) {
                array_push($violations, ...($e->violations !== [] ? $e->violations : [new Violation($e->errorCode, $e->getMessage())]));
            }
        }

        return new InvoicePostingPreview($violations === [], $violations, $period?->id, $period?->name, $period?->status->value, $debit, $credit, $lines);
    }
}
