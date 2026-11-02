<?php

declare(strict_types=1);

namespace App\Services\Ledger;

use App\Contracts\Clock;
use App\Contracts\IdGenerator;
use App\Contracts\PermissionChecker;
use App\Domain\Fiscal\PeriodStatus;
use App\Domain\Ledger\AccountInfo;
use App\Domain\Ledger\DimensionValueInfo;
use App\Domain\Ledger\DraftLine;
use App\Domain\Ledger\JournalDraft;
use App\Domain\Ledger\JournalStatus;
use App\Domain\Ledger\JournalType;
use App\Domain\Ledger\PostingContext;
use App\Domain\Ledger\PostingPlan;
use App\Domain\Ledger\PostingValidator;
use App\Models\Fiscal\FiscalPeriod;
use App\Models\Ledger\Account;
use App\Models\Ledger\DimensionValue;
use App\Models\Ledger\Journal;
use App\Models\Organisation\Company;
use App\Support\Actor;
use App\Support\UnitOfWork\LockSet;
use DateTimeImmutable;
use Illuminate\Database\DatabaseManager;

/**
 * The only code that inserts journals and journal lines (13 §3, §9). Called by Ledger Actions
 * inside their UnitOfWork; it never opens transactions itself.
 */
final class PostingEngine
{
    private const string UUID = '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/';

    public function __construct(
        private readonly PostingValidator $validator,
        private readonly PermissionChecker $permissions,
        private readonly IdGenerator $ids,
        private readonly Clock $clock,
        private readonly DatabaseManager $db,
    ) {}

    /**
     * Lock (level 1) the period a journal posts into. An explicitly chosen period is honoured (and
     * validated: kind, status, date). Otherwise closing/adjustment journals have none (D7: never
     * resolved from a date) and other journals use the regular period containing $date.
     */
    public function lockPeriod(LockSet $locks, string $companyId, JournalType $type, DateTimeImmutable $date, ?string $periodId): ?FiscalPeriod
    {
        if ($periodId !== null) {
            return $locks->periodsById($companyId, [$periodId])[0] ?? null;
        }
        if ($type->isAdjustmentPeriodType()) {
            return null;
        }

        return self::periodContaining($locks->periodsForPost($companyId, [$date]), $date);
    }

    /** @param list<FiscalPeriod> $periods */
    public static function periodContaining(array $periods, DateTimeImmutable $date): ?FiscalPeriod
    {
        foreach ($periods as $period) {
            if ($period->kind === 'regular' && $period->toInfo()->contains($date)) {
                return $period;
            }
        }

        return null;
    }

    public function context(Actor $actor, JournalDraft $draft, ?FiscalPeriod $period): PostingContext
    {
        $company = Company::query()->findOrFail($draft->companyId);

        $accountIds = array_values(array_filter(
            array_unique(array_map(fn (DraftLine $l) => $l->accountId, $draft->lines)),
            fn (string $id) => preg_match(self::UUID, $id) === 1,
        ));
        $accounts = [];
        foreach (Account::query()->where('company_id', $company->id)->whereIn('id', $accountIds)->with('dimensionRules.dimension')->get() as $a) {
            $rules = [];
            foreach ($a->dimensionRules as $rule) {
                $rules[$rule->dimension->position] = $rule->rule;
            }
            $accounts[$a->id] = new AccountInfo(
                $a->id, $a->code, $a->is_postable, $a->is_active, $a->control_type, $a->currency_policy,
                $a->fixed_currency, $a->allow_manual_journals, $rules,
            );
        }

        $valueIds = [];
        foreach ($draft->lines as $line) {
            foreach ($line->dims as $id) {
                if (is_string($id) && preg_match(self::UUID, $id) === 1) {
                    $valueIds[$id] = true;
                }
            }
        }
        $values = [];
        if ($valueIds !== []) {
            foreach (DimensionValue::query()->where('company_id', $company->id)->whereIn('id', array_keys($valueIds))->with('dimension')->get() as $v) {
                $values[$v->id] = new DimensionValueInfo($v->id, $v->dimension->position, $v->is_active && $v->dimension->is_active);
            }
        }

        $human = ! $actor->isApiClient();

        return new PostingContext(
            baseCurrency: $company->base_currency,
            accounts: $accounts,
            dimensionValues: $values,
            period: $period?->toInfo(),
            canPostSoftClosed: $human && $this->permissions->allows($actor, 'periods.post_soft_closed', $company->id),
            canPostAdjustment: $human && $this->permissions->allows($actor, 'periods.post_adjustment', $company->id),
        );
    }

    public function decide(JournalDraft $draft, PostingContext $ctx, FiscalPeriod $period): PostingPlan
    {
        $plan = $this->validator->validate($draft, $ctx);

        if ($period->status === PeriodStatus::SoftClosed) {
            // Permission already checked by the validator; transaction-scoped so it cannot leak (13 §9).
            $this->db->connection()->statement("SET LOCAL app.allow_soft_closed = 'on'");
        }

        return $plan;
    }

    /** @return array{0: string, 1: string} sequence key and number prefix */
    public function sequenceFor(FiscalPeriod $period): array
    {
        $year = $period->fiscalYear()->firstOrFail();

        return ['journal:'.$year->name, 'JV-'.$year->name.'-'];
    }

    /**
     * Insert a draft header and its lines (one multi-row insert).
     *
     * @param  array<string, mixed>  $extra  additional header columns (e.g. reversal_of_id)
     */
    public function insertDraft(Actor $actor, string $id, JournalDraft $draft, string $baseCurrency, ?string $periodId, array $extra = []): Journal
    {
        $journal = new Journal;
        $journal->forceFill([
            'id' => $id,
            'tenant_id' => $actor->tenantId,
            'company_id' => $draft->companyId,
            'fiscal_period_id' => $periodId,
            'journal_type' => $draft->type,
            'status' => JournalStatus::Draft,
            'journal_date' => $draft->date,
            'reference' => $draft->reference,
            'memo' => $draft->memo,
            'source_type' => $draft->sourceType,
            'source_id' => $draft->sourceId,
            'created_by' => $actor->id,
            'lock_version' => 0,
            ...self::totals($draft->lines),
            ...$extra,
        ])->save();

        $this->insertLines($actor, $journal, $draft->lines, $baseCurrency);

        return $journal;
    }

    /**
     * What the lines add up to, shown on a journal before it posts. Posting recomputes them from its plan.
     *
     * @param  list<DraftLine>  $lines
     * @return array{total_debit: int, total_credit: int}
     */
    public static function totals(array $lines): array
    {
        return [
            'total_debit' => array_sum(array_map(fn (DraftLine $l): int => $l->debit, $lines)),
            'total_credit' => array_sum(array_map(fn (DraftLine $l): int => $l->credit, $lines)),
        ];
    }

    /** @param list<DraftLine> $lines */
    public function insertLines(Actor $actor, Journal $journal, array $lines, string $baseCurrency): void
    {
        $now = $this->clock->now()->format('Y-m-d H:i:s.uP');
        $rows = [];
        foreach ($lines as $i => $line) {
            $foreign = $line->currency !== null && $line->currency !== $baseCurrency;
            $row = [
                'id' => $this->ids->next(),
                'tenant_id' => $actor->tenantId,
                'company_id' => $journal->company_id,
                'journal_id' => $journal->id,
                'line_no' => $i + 1,
                'account_id' => $line->accountId,
                'debit' => $line->debit,
                'credit' => $line->credit,
                'currency' => $foreign ? $line->currency : $baseCurrency,
                'fx_rate' => $foreign ? ($line->fxRate ?? '0') : '1',
                'amount_fc' => $foreign ? ($line->amountFc ?? 0) : $line->debit - $line->credit,
                'description' => $line->description,
                'contact_id' => $line->contactId,
                'tax_code_id' => $line->taxCodeId,
                'due_date' => $line->dueDate,
                'created_at' => $now,
                'updated_at' => $now,
            ];
            for ($p = 1; $p <= 8; $p++) {
                $row["dim{$p}_value_id"] = $line->dim($p);
            }
            $rows[] = $row;
        }

        if ($rows !== []) {
            $this->db->connection()->table('journal_lines')->insert($rows);
        }
    }

    /** Flip a draft to posted. Lines are already in place; the deferred balance trigger checks at commit. */
    public function markPosted(Journal $journal, PostingPlan $plan, string $number, FiscalPeriod $period, Actor $actor): Journal
    {
        $journal->forceFill([
            'fiscal_period_id' => $period->id,
            'number' => $number,
            'total_debit' => $plan->totalDebit,
            'total_credit' => $plan->totalCredit,
            'posted_at' => $this->clock->now(),
            'posted_by' => $actor->id,
            'status' => JournalStatus::Posted,
            'lock_version' => $journal->lock_version + 1,
        ])->save();

        return $journal;
    }

    /** Rebuild the Domain draft from a stored journal and its lines. */
    public function draftOf(Journal $journal, string $baseCurrency, ?DateTimeImmutable $reversalOfDate = null): JournalDraft
    {
        return new JournalDraft(
            companyId: $journal->company_id,
            type: $journal->journal_type,
            date: $journal->journal_date,
            lines: array_values($journal->lines->map(fn ($l) => $l->toDraftLine($baseCurrency))->all()),
            reference: $journal->reference,
            memo: $journal->memo,
            sourceType: $journal->source_type,
            sourceId: $journal->source_id,
            reversalOfDate: $reversalOfDate,
        );
    }
}
