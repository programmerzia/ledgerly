<?php

declare(strict_types=1);

namespace App\Queries\Reports;

use App\Models\Organisation\Company;
use App\Support\Reports\ReportRunner;
use Illuminate\Validation\ValidationException;
use InvalidArgumentException;

/**
 * The statements (trial balance, profit and loss, balance sheet, cash flow) by their URL name: resolves the
 * request's parameters and answers the cached result. One entry point for the API and the exports, so both
 * show the same numbers from the same cache entry.
 */
final class RunReport
{
    /** URL name → report key */
    public const array STATEMENTS = [
        'trial-balance' => 'trial_balance',
        'profit-and-loss' => 'profit_and_loss',
        'balance-sheet' => 'balance_sheet',
        'cash-flow' => 'cash_flow',
        'ar-aging' => 'ar_aging',
        'ap-aging' => 'ap_aging',
        'customer-statement' => 'customer_statement',
        'supplier-statement' => 'supplier_statement',
        'tax-return' => 'tax_return',
        'asset-schedule' => 'asset_schedule',
    ];

    public function __construct(
        private readonly ReportRunner $runner,
        private readonly ReportParamsResolver $params,
        private readonly TrialBalance $trialBalance,
        private readonly ProfitAndLoss $profitAndLoss,
        private readonly BalanceSheet $balanceSheet,
        private readonly CashFlow $cashFlow,
        private readonly ArApAging $aging,
        private readonly ContactStatement $statement,
        private readonly TaxReturn $taxReturn,
        private readonly AssetSchedule $assetSchedule,
    ) {}

    /**
     * @param  array<string, mixed>  $input  validated request input
     * @return array<string, mixed>
     */
    public function __invoke(string $name, Company $company, array $input): array
    {
        $key = self::STATEMENTS[$name] ?? throw new InvalidArgumentException("Unknown report {$name}.");
        [$p, $query] = match ($name) {
            'trial-balance' => [$this->params->asOf($company, $input), $this->trialBalance],
            'balance-sheet' => [$this->params->asOf($company, $input), $this->balanceSheet],
            'profit-and-loss' => [$this->params->range($company, $input), $this->profitAndLoss],
            'ar-aging' => [$this->params->asOf($company, $input), fn (ReportParams $p): array => ($this->aging)($p, true)],
            'ap-aging' => [$this->params->asOf($company, $input), fn (ReportParams $p): array => ($this->aging)($p, false)],
            'customer-statement' => [$this->params->range($company, $input), fn (ReportParams $p): array => ($this->statement)($p, true)],
            'supplier-statement' => [$this->params->range($company, $input), fn (ReportParams $p): array => ($this->statement)($p, false)],
            'tax-return' => [$this->params->range($company, $input), $this->taxReturn],
            'asset-schedule' => [$this->params->range($company, $input), $this->assetSchedule],
            default => [$this->params->range($company, $input), $this->cashFlow],
        };
        if ($name === 'cash-flow' && $p->dims !== []) {
            throw ValidationException::withMessages(['dimensions' => ['The cash flow statement cannot be filtered by dimension.']]);
        }

        return $this->runner->cached($company->id, $key, $p->cacheKey(), fn (): array => ['generated_at' => gmdate('Y-m-d\TH:i:s\Z')] + $query($p));
    }
}
