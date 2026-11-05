<?php

declare(strict_types=1);

namespace App\Services\Transactions;

use App\Contracts\IdGenerator;
use App\Domain\Ledger\DraftLine;
use App\Domain\Ledger\JournalDraft;
use App\Domain\Ledger\JournalType;
use App\Domain\Shared\DomainRuleViolation;
use App\Domain\Transactions\ProvisionMatrix;
use App\Models\Organisation\Company;
use App\Models\Transactions\ProvisionRun;
use App\Queries\Reports\ArApAging;
use App\Queries\Reports\ReportParams;
use App\Services\Trade\PostingAccountResolver;
use Brick\Math\BigDecimal;
use DateTimeImmutable;
use Illuminate\Support\Facades\DB;

/** The numbers of a provisioning run: AR aging by bucket as of a date, the rates, the allowance held, and the journal for the difference. */
final class ProvisionService
{
    public function __construct(private readonly ArApAging $aging, private readonly PostingAccountResolver $accounts) {}

    /** @return array<string, string> bucket → percentage; every bucket must have a rate set */
    public function rates(string $companyId): array
    {
        $rates = DB::table('provision_rates')->where('company_id', $companyId)->pluck('rate_pct', 'bucket')->map(fn ($v): string => (string) $v)->all();
        $missing = array_values(array_diff(ProvisionMatrix::BUCKETS, array_keys($rates)));
        if ($missing !== []) {
            throw DomainRuleViolation::single('provision_rates_missing', 'Set a rate for every aging bucket before running a provision (Settings → Provisioning).');
        }

        return $rates;
    }

    /**
     * @return array{required: int, existing: int, difference: int, detail: array{rows: list<array{bucket: string, label: string, balance: int, rate_pct: string, amount: int}>, as_of: string, open_receivables: int, allowance_account_id: string, basis: string}, allowance_id: string}
     */
    public function compute(Company $company, DateTimeImmutable $asOf): array
    {
        $rates = $this->rates($company->id);
        $allowance = $this->accounts->required($company, 'credit_loss_allowance', 'credit-loss allowance');
        $this->accounts->required($company, 'bad_debt_expense', 'bad-debt expense');

        $report = ($this->aging)(new ReportParams($company->id, $company->base_currency, null, $asOf->format('Y-m-d'), 'accrual', 'none', null, [], [], false), true);
        $balances = [];
        foreach (ProvisionMatrix::BUCKETS as $bucket) {
            $balances[$bucket] = (int) $report['totals'][$bucket]['amount'];
        }
        $matrix = ProvisionMatrix::required($balances, $rates);
        $existing = $this->held($company, $allowance, $asOf);

        return [
            'required' => $matrix['required'], 'existing' => $existing, 'difference' => $matrix['required'] - $existing, 'allowance_id' => $allowance,
            'detail' => ['rows' => $matrix['rows'], 'as_of' => $asOf->format('Y-m-d'), 'open_receivables' => array_sum($balances), 'allowance_account_id' => $allowance, 'basis' => 'ar_aging_by_due_date'],
        ];
    }

    /** Net credit on the allowance account on posted lines dated on or before the as-of date. */
    public function held(Company $company, string $allowanceId, DateTimeImmutable $asOf): int
    {
        return (int) DB::table('journal_lines as l')->join('journals as j', 'j.id', '=', 'l.journal_id')
            ->where('l.company_id', $company->id)->where('l.account_id', $allowanceId)->whereIn('j.status', ['posted', 'reversed'])
            ->where('j.journal_date', '<=', $asOf->format('Y-m-d'))->selectRaw('COALESCE(SUM(l.credit - l.debit), 0) AS net')->value('net');
    }

    public function draft(ProvisionRun $run, Company $company, string $number): JournalDraft
    {
        $allowance = $this->accounts->required($company, 'credit_loss_allowance', 'credit-loss allowance');
        $expense = $this->accounts->required($company, 'bad_debt_expense', 'bad-debt expense');
        $move = ProvisionMatrix::movement($run->required, $run->existing);
        $day = $run->as_of->format('Y-m-d');
        $a = $move['amount'];
        $text = "Provision {$number} as of {$day}";
        $lines = $move['debit'] === 'expense'
            ? [new DraftLine($expense, $a, 0, description: "{$text}: charge"), new DraftLine($allowance, 0, $a, description: "{$text}: allowance raised")]
            : [new DraftLine($allowance, $a, 0, description: "{$text}: allowance released"), new DraftLine($expense, 0, $a, description: "{$text}: charge reduced")];

        return new JournalDraft(
            $company->id, JournalType::Manual, new DateTimeImmutable($day), $lines, $number,
            "Bad-debt provision {$number}: required {$run->required}, held {$run->existing}", 'provision_run', $run->id,
        );
    }

    /** @return array<string, string> whatever rates are stored, possibly none */
    public function storedRates(string $companyId): array
    {
        return DB::table('provision_rates')->where('company_id', $companyId)->pluck('rate_pct', 'bucket')->map(fn ($v): string => (string) $v)->all();
    }

    /** @param array<string, string> $ratesPct all five buckets */
    public function writeRates(string $tenantId, string $companyId, array $ratesPct): void
    {
        foreach (ProvisionMatrix::BUCKETS as $bucket) {
            $rate = $ratesPct[$bucket];
            if (preg_match('/^\d{1,3}(\.\d{1,4})?$/', $rate) !== 1 || BigDecimal::of($rate)->isGreaterThan(100)) {
                throw DomainRuleViolation::single('provision_rate_invalid', 'A rate is a percentage from 0 to 100 with up to four decimals.');
            }
            $id = DB::table('provision_rates')->where('company_id', $companyId)->where('bucket', $bucket)->value('id');
            if ($id === null) {
                DB::table('provision_rates')->insert(['id' => app(IdGenerator::class)->next(), 'tenant_id' => $tenantId, 'company_id' => $companyId, 'bucket' => $bucket, 'rate_pct' => $rate, 'created_at' => now(), 'updated_at' => now()]);
            } else {
                DB::table('provision_rates')->where('id', $id)->update(['rate_pct' => $rate, 'updated_at' => now()]);
            }
        }
    }
}
