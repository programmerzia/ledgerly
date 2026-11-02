<?php

declare(strict_types=1);

namespace App\Queries\Practice;

use App\Models\Organisation\Company;
use App\Queries\Reports\ArApAging;
use App\Queries\Reports\ReportParamsResolver;
use App\Support\Reports\ReportRunner;

/**
 * The figures of one company for the practice overview (13 §7): open receivables and payables from the AR/AP
 * aging reports (base currency, as of today, credits not netted), documents waiting for approval, the last closed
 * period and the count of periods per state. Aggregates only; never account or contact data. Runs inside the
 * company's tenant context, on the reporting connection.
 */
final class CompanyKpis
{
    public function __construct(
        private readonly ReportRunner $runner,
        private readonly ReportParamsResolver $params,
        private readonly ArApAging $aging,
    ) {}

    /** @return array{company_id: string, company_name: string, base_currency: string, open_ar: int, open_ap: int, pending_approvals: int, last_closed_period: string|null, period_states: array<string, int>} */
    public function __invoke(Company $company): array
    {
        $p = $this->params->asOf($company, []);
        $db = $this->runner->db();

        $approvals = $db->selectOne(
            "SELECT count(DISTINCT (document_type, document_id)) AS n FROM approval_requests WHERE company_id = ? AND status = 'pending'",
            [$company->id],
        );
        $closed = $db->selectOne(
            "SELECT max(ends_on) AS d FROM fiscal_periods WHERE company_id = ? AND kind = 'regular' AND status IN ('closed', 'locked')",
            [$company->id],
        );
        $states = ['open' => 0, 'soft_closed' => 0, 'closed' => 0, 'locked' => 0];
        foreach ($db->select('SELECT status::text AS status, count(*) AS n FROM fiscal_periods WHERE company_id = ? GROUP BY status', [$company->id]) as $row) {
            $states[(string) $row->status] = (int) $row->n;
        }

        return [
            'company_id' => $company->id,
            'company_name' => $company->name,
            'base_currency' => $company->base_currency,
            'open_ar' => $this->open(($this->aging)($p, true)),
            'open_ap' => $this->open(($this->aging)($p, false)),
            'pending_approvals' => (int) ($approvals->n ?? 0),
            'last_closed_period' => isset($closed->d) ? (string) $closed->d : null,
            'period_states' => $states,
        ];
    }

    /** @param array<string, mixed> $report */
    private function open(array $report): int
    {
        /** @var array{open: array{amount: int}} $totals */
        $totals = $report['totals'];

        return $totals['open']['amount'];
    }
}
