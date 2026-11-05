<?php

declare(strict_types=1);

namespace App\Support\UnitOfWork;

use App\Domain\Ledger\BalanceDelta;
use App\Models\Fiscal\FiscalPeriod;
use App\Services\Ledger\SequenceAllocator;
use DateTimeImmutable;
use Illuminate\Database\Connection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Log;

/**
 * Acquires row locks in the global order (13 §8):
 *   1 fiscal_periods → 2 documents → 3 sequences → 4 account_period_balances → 5 audit head.
 * Out-of-order acquisition throws LockOrderViolation (logged only in production).
 */
final class LockSet
{
    public const int PERIODS = 1;

    public const int DOCUMENTS = 2;

    public const int SEQUENCES = 3;

    public const int BALANCES = 4;

    public const int AUDIT_HEAD = 5;

    /** Document ordering within level 2: (table rank, id). */
    private const array DOCUMENT_RANK = [
        'journals' => 10, 'payment_runs' => 15, 'settlements' => 20, 'invoices' => 30,
        'purchase_requisitions' => 32, 'purchase_order_revisions' => 33, 'purchase_orders' => 34, 'goods_receipts' => 36,
        'bank_accounts' => 40, 'bank_reconciliations' => 42, 'bank_statement_lines' => 45, 'fx_revaluations' => 50, 'depreciation_runs' => 60, 'asset_transactions' => 62, 'asset_categories' => 68, 'fixed_assets' => 70,
    ];

    private int $level = 0;

    private string $lastKey = '';

    /** @var array<string, true> */
    private array $held = [];

    /** @var array<string, FiscalPeriod> */
    private array $periods = [];

    /** @var array<string, true> companies whose balance projection this transaction changed */
    private array $changedCompanies = [];

    public function __construct(
        private readonly Connection $db,
        private readonly SequenceAllocator $sequences,
        private readonly string $tenantId,
        private readonly bool $strict,
    ) {}

    /**
     * Level 1, posting mode: FOR KEY SHARE on the regular periods containing $dates.
     *
     * @param  list<DateTimeImmutable>  $dates
     * @return list<FiscalPeriod> ordered by starts_on
     */
    public function periodsForPost(string $companyId, array $dates): array
    {
        $days = array_values(array_unique(array_map(fn (DateTimeImmutable $d) => $d->format('Y-m-d'), $dates)));

        $periods = FiscalPeriod::query()
            ->where('company_id', $companyId)
            ->where('kind', 'regular')
            ->whereRaw("daterange(starts_on, ends_on, '[]') @> ANY (?::date[])", ['{'.implode(',', $days).'}'])
            ->orderBy('starts_on')->orderBy('id')
            ->lock('FOR KEY SHARE')
            ->get();

        return $this->registerPeriods(array_values($periods->all()));

    }

    /**
     * Level 1 by id. Posting uses FOR KEY SHARE; close, reopen, year-end and runs use FOR UPDATE.
     *
     * @param  list<string>  $periodIds
     * @return list<FiscalPeriod>
     */
    public function periodsById(string $companyId, array $periodIds, bool $forUpdate = false): array
    {
        $periods = FiscalPeriod::query()
            ->where('company_id', $companyId)
            ->whereIn('id', $periodIds)
            ->orderBy('starts_on')->orderBy('kind')->orderBy('id')
            ->lock($forUpdate ? 'FOR UPDATE' : 'FOR KEY SHARE')
            ->get();

        return $this->registerPeriods(array_values($periods->all()));
    }

    /** @return array<string, FiscalPeriod> every period locked so far, by id */
    public function periods(): array
    {
        return $this->periods;
    }

    /**
     * Level 2: re-read $document FOR UPDATE and check its lock_version.
     *
     * @template T of Model
     *
     * @param  T  $document
     * @return T
     */
    public function document(Model $document, ?int $expectedVersion = null): Model
    {
        $table = $document->getTable();
        $rank = self::DOCUMENT_RANK[$table] ?? 99;
        $id = (string) $document->getKey();
        $this->enter(self::DOCUMENTS, sprintf('%02d:%s', $rank, $id));

        /** @var T $locked */
        $locked = $document->newQuery()->whereKey($id)->lockForUpdate()->firstOrFail();

        $serverVersion = (int) $locked->getAttribute('lock_version');
        if ($expectedVersion !== null && $serverVersion !== $expectedVersion) {
            throw new VersionConflict($serverVersion, $expectedVersion);
        }

        return $locked;
    }

    /** Level 3: allocate the next gapless number for $key. */
    public function sequence(string $companyId, string $key, string $prefix): string
    {
        $this->enter(self::SEQUENCES, $key);

        return $this->sequences->next($this->db, $this->tenantId, $companyId, $key, $prefix);
    }

    /**
     * Level 4: apply balance deltas with one sorted multi-row upsert.
     *
     * @param  list<BalanceDelta>  $deltas
     */
    public function balances(string $companyId, string $periodId, array $deltas): void
    {
        if ($deltas === []) {
            return;
        }
        $this->changedCompanies[$companyId] = true;
        usort($deltas, fn (BalanceDelta $a, BalanceDelta $b) => strcmp($a->accountId.bin2hex($a->dimKey()), $b->accountId.bin2hex($b->dimKey())));

        $rows = [];
        $bindings = [];
        foreach ($deltas as $delta) {
            $this->enter(self::BALANCES, $delta->accountId.'|'.$periodId.'|'.bin2hex($delta->dimKey()));
            $rows[] = '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, decode(?, \'hex\'), ?, ?)';
            array_push($bindings, $this->tenantId, $companyId, $delta->accountId, $periodId);
            for ($p = 1; $p <= 8; $p++) {
                $bindings[] = $delta->dims[$p] ?? null;
            }
            array_push($bindings, bin2hex($delta->dimKey()), $delta->debit, $delta->credit);
        }

        $this->db->statement(
            'INSERT INTO account_period_balances (tenant_id, company_id, account_id, fiscal_period_id, '
            .'dim1_value_id, dim2_value_id, dim3_value_id, dim4_value_id, dim5_value_id, dim6_value_id, dim7_value_id, dim8_value_id, '
            .'dim_key, debit, credit) VALUES '.implode(', ', $rows)
            .' ON CONFLICT (tenant_id, company_id, account_id, fiscal_period_id, dim_key) DO UPDATE SET '
            .'debit = account_period_balances.debit + EXCLUDED.debit, credit = account_period_balances.credit + EXCLUDED.credit',
            $bindings,
        );
    }

    /**
     * Companies whose balances this transaction posted into: their report caches go stale at commit (13 §13).
     *
     * @return list<string>
     */
    public function changedCompanies(): array
    {
        return array_keys($this->changedCompanies);
    }

    /** Level 5: only the pre-commit audit flush calls this. */
    public function enterAuditHead(): void
    {
        $this->enter(self::AUDIT_HEAD, $this->tenantId);
    }

    /**
     * @param  list<FiscalPeriod>  $periods
     * @return list<FiscalPeriod>
     */
    private function registerPeriods(array $periods): array
    {
        foreach ($periods as $period) {
            $this->enter(self::PERIODS, $period->starts_on->format('Y-m-d').'|'.$period->kind.'|'.$period->id);
            $this->periods[(string) $period->id] = $period;
        }

        return $periods;
    }

    private function enter(int $level, string $key): void
    {
        $id = $level.'#'.$key;
        if (isset($this->held[$id])) {
            return;
        }

        if ($level < $this->level || ($level === $this->level && strcmp($key, $this->lastKey) < 0)) {
            $message = "Lock order violation: level {$level} key {$key} after level {$this->level} key {$this->lastKey}";
            if ($this->strict) {
                throw new LockOrderViolation($message);
            }
            Log::warning($message);
        }

        $this->held[$id] = true;
        $this->level = $level;
        $this->lastKey = $key;
    }
}
