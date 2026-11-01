<?php

declare(strict_types=1);

namespace App\Actions\Fx;

use App\Actions\Fx\Inputs\RunFxRevaluationInput;
use App\Actions\Ledger\Inputs\RecordJournalInput;
use App\Actions\Ledger\RecordJournal;
use App\Contracts\IdGenerator;
use App\Contracts\PermissionChecker;
use App\Domain\Fiscal\PeriodStatus;
use App\Domain\Ledger\DraftLine;
use App\Domain\Ledger\JournalDraft;
use App\Domain\Shared\DomainRuleViolation;
use App\Domain\Shared\Violation;
use App\Domain\Trade\PostingAccounts;
use App\Domain\Trade\ProposedJournal;
use App\Domain\Trade\RevaluationInput;
use App\Domain\Trade\RevaluationPosting;
use App\Models\Fiscal\FiscalPeriod;
use App\Models\Fx\FxRevaluation;
use App\Models\Ledger\Account;
use App\Models\Ledger\Dimension;
use App\Models\Ledger\DimensionValue;
use App\Models\Organisation\Company;
use App\Models\Organisation\CompanySettings;
use App\Services\Fx\FxRevaluationCalculator;
use App\Support\Actor;
use App\Support\ActorType;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;
use DateTimeImmutable;

/**
 * Month-end unrealised FX revaluation of monetary balance-sheet items (IAS 21.23, 13 §8, §9).
 *
 * Takes the period FOR UPDATE for the whole run, so no posting can land between reading the balances and
 * posting the result, and a concurrent second run waits and is then refused. One run per period: also the
 * partial unique index on fx_revaluations. The adjustment is built by Domain\Trade\RevaluationPosting and
 * posted by RecordJournal as an `fx` journal dated the as-of day. The automatic reversal on the first day of
 * the next period follows in ReverseFxRevaluation, or stays pending until that period exists and is open.
 *
 * A person needs `fx.manage` and a signing grant (ADR-0004); the scheduler (system actor) needs neither; API
 * clients never run it.
 */
final class RunFxRevaluation
{
    public function __construct(
        private readonly UnitOfWork $uow,
        private readonly PermissionChecker $permissions,
        private readonly FxRevaluationCalculator $calculator,
        private readonly RecordJournal $record,
        private readonly ReverseFxRevaluation $reversal,
        private readonly IdGenerator $ids,
    ) {}

    public function handle(Actor $actor, RunFxRevaluationInput $in): FxRevaluation
    {
        $this->authorize($actor, $in->companyId);

        // Earlier runs still waiting for their reversal go first (own transactions, see ReverseFxRevaluation).
        $this->reversal->pending($actor->tenantId, $in->companyId);

        $run = $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $in) {
            $found = FiscalPeriod::query()->where('company_id', $in->companyId)->find($in->periodId)
                ?? throw DomainRuleViolation::single('not_found', 'The period does not exist.');
            if ($found->kind !== 'regular') {
                throw DomainRuleViolation::single('fx_period_invalid', 'A revaluation runs on a regular period, not the adjustment period.');
            }

            $period = $locks->periodsById($in->companyId, [$found->id], forUpdate: true)[0]
                ?? throw DomainRuleViolation::single('not_found', 'The period does not exist.');
            if (! in_array($period->status, [PeriodStatus::Open, PeriodStatus::SoftClosed], true)) {
                throw DomainRuleViolation::single('period_closed', "The period is {$period->status->value}; reopen it before revaluing.");
            }
            if (FxRevaluation::query()->where('company_id', $in->companyId)->where('fiscal_period_id', $period->id)->whereNotIn('status', ['void', 'reversed'])->exists()) {
                throw DomainRuleViolation::single('fx_revaluation_exists', 'This period already has a revaluation run.');
            }
            $asOf = $this->asOf($period, $in->asOf);

            $company = Company::query()->findOrFail($in->companyId);
            $plan = $this->calculator->plan($company->id, $company->base_currency, $asOf);
            if ($plan->missingRates !== []) {
                $violations = array_map(static fn (string $c): Violation => new Violation('fx_rate_missing', "No {$c}/{$company->base_currency} rate on or before {$asOf}."), $plan->missingRates);
                throw new DomainRuleViolation('fx_rate_missing', 'Closing rates are missing for: '.implode(', ', $plan->missingRates).'.', $violations);
            }

            $id = $this->ids->next();
            $journal = null;
            if (! $plan->isEmpty()) {
                $proposed = RevaluationPosting::journal(
                    new RevaluationInput($id, $asOf, $plan->items, $this->dimensions($company)),
                    $this->postingAccounts($company), $company->base_currency,
                );
                $journal = $this->record->handle($actor, new RecordJournalInput($this->draft($company, $proposed), $period->id));
            }

            $run = new FxRevaluation;
            $run->forceFill([
                'id' => $id, 'tenant_id' => $actor->tenantId, 'company_id' => $company->id, 'fiscal_period_id' => $period->id,
                'as_of' => $asOf, 'status' => 'posted', 'journal_id' => $journal?->id, 'base_currency' => $company->base_currency,
                'total_unrealised' => $plan->total(),
                'detail' => ['rows' => $plan->rows, 'residuals' => $plan->residuals, 'skipped_zero' => count($plan->rows) - count($plan->items)],
                'created_by' => $actor->id,
            ])->save();
            $audit->add('fx_revaluation.run', $run, after: $run, context: ['journal_id' => $journal?->id, 'items' => count($plan->items)]);

            return $run;
        });

        $this->reversal->attempt(Actor::system($actor->tenantId, $in->companyId), $run->id);

        return FxRevaluation::query()->findOrFail($run->id);
    }

    private function authorize(Actor $actor, string $companyId): void
    {
        if ($actor->isApiClient()) {
            throw DomainRuleViolation::single('forbidden', 'Only a person can run a revaluation.');
        }
        if ($actor->type === ActorType::User) {
            if (! $this->permissions->allows($actor, 'fx.manage', $companyId)) {
                throw DomainRuleViolation::single('forbidden', 'This needs the fx.manage permission.');
            }
            if (! $actor->hasSigningGrant) {
                throw DomainRuleViolation::single('signature_required', 'Running a revaluation needs your signing PIN.');
            }
        }
    }

    private function asOf(FiscalPeriod $period, ?string $asOf): string
    {
        $start = $period->starts_on->format('Y-m-d');
        $end = $period->ends_on->format('Y-m-d');
        $day = $asOf ?? $end;
        if ($day < $start || $day > $end) {
            throw DomainRuleViolation::single('fx_as_of_outside_period', "The as-of date must fall within {$start} and {$end}.");
        }

        return $day;
    }

    /** The unrealised-FX account from the company's posting accounts (an account id, or its code). */
    private function postingAccounts(Company $company): PostingAccounts
    {
        $raw = CompanySettings::query()->where('company_id', $company->id)->first()?->getAttribute('posting_accounts');
        /** @var array<string, mixed> $settings */
        $settings = is_string($raw) ? (json_decode($raw, true) ?: []) : (is_array($raw) ? $raw : []);
        $ref = $settings['fx_unrealised'] ?? null;

        $account = is_string($ref) && $ref !== ''
            ? Account::query()->where('company_id', $company->id)->where(fn ($q) => $q->where('code', $ref)->when(
                preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/', $ref) === 1,
                fn ($q2) => $q2->orWhere('id', $ref),
            ))->first()
            : null;
        if ($account === null) {
            throw DomainRuleViolation::single('posting_account_missing', 'Set the unrealised FX gain/loss account (posting_accounts.fx_unrealised) in the company settings.');
        }

        return new PostingAccounts('', '', '', '', '', $account->id, '', '');
    }

    /**
     * Dimensions for the adjustment lines from the company settings: `fx_revaluation_dimensions` maps a dimension
     * code to a value code. Keys of the result are `dim<position>`, values are value ids.
     *
     * @return array<string, string>
     */
    private function dimensions(Company $company): array
    {
        /** @var array<string, mixed> $settings */
        $settings = $company->settings ?? [];
        $map = $settings['fx_revaluation_dimensions'] ?? [];
        $out = [];
        foreach (is_array($map) ? $map : [] as $dimensionCode => $valueCode) {
            $dimension = Dimension::query()->where('company_id', $company->id)->where('code', (string) $dimensionCode)->first();
            $value = $dimension === null ? null : DimensionValue::query()->where('company_id', $company->id)->where('dimension_id', $dimension->id)->where('code', (string) $valueCode)->first();
            if ($dimension === null || $value === null) {
                throw DomainRuleViolation::single('fx_dimension_invalid', "The revaluation dimension {$dimensionCode}={$valueCode} in the company settings does not exist.");
            }
            $out['dim'.$dimension->position] = $value->id;
        }

        return $out;
    }

    /**
     * Foreign amounts on the adjusting lines carry the side of the base amount (the validator requires it); they
     * are informational only: revaluation moves base, and the calculator ignores these lines when it sums foreign
     * balances.
     */
    private function draft(Company $company, ProposedJournal $proposed): JournalDraft
    {
        $base = $company->base_currency;
        $lines = array_map(static function ($l) use ($base): DraftLine {
            $foreign = $l->currency !== $base;
            $dims = [];
            foreach ($l->dimensions as $position => $valueId) {
                $dims[(int) substr($position, 3)] = $valueId;
            }

            return new DraftLine(
                $l->accountRef, $l->debit, $l->credit, $l->currency, $foreign ? $l->fxRate : null,
                $foreign ? ($l->debit > 0 ? 1 : -1) * abs($l->amountFc) : null,
                $dims, $l->description, $l->contactRef, $l->taxCodeRef,
            );
        }, $proposed->lines);

        return new JournalDraft(
            $company->id, $proposed->journalType, new DateTimeImmutable($proposed->journalDate), $lines,
            $proposed->reference, $proposed->memo, $proposed->sourceType, $proposed->sourceId,
        );
    }
}
