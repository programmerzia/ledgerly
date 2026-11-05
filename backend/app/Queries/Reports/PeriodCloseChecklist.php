<?php

declare(strict_types=1);

namespace App\Queries\Reports;

use App\Models\Fiscal\FiscalPeriod;
use App\Queries\Fiscal\PreviewPeriodCloseChecks;
use App\Support\Reports\ReportRunner;
use Illuminate\Validation\ValidationException;

/**
 * The period close checklist as a report (3c.20). A period that is closed shows the outcomes recorded when it was closed,
 * with who waived a failed check and why; any other period shows the checks as they stand now (the same preview the close
 * dialog uses). Writes nothing.
 */
final class PeriodCloseChecklist
{
    public function __construct(private readonly ReportRunner $runner, private readonly PreviewPeriodCloseChecks $preview) {}

    /** @return array<string, mixed> */
    public function __invoke(string $companyId, string $periodId): array
    {
        $db = $this->runner->db();
        $p = $db->selectOne(
            'SELECT p.id, p.name, p.kind, p.starts_on, p.ends_on, p.status, p.closed_at, cu.name AS closed_by_name FROM fiscal_periods p LEFT JOIN users cu ON cu.id = p.closed_by WHERE p.company_id = ? AND p.id = ?',
            [$companyId, $periodId],
        );
        if ($p === null) {
            throw ValidationException::withMessages(['period_id' => ['The period does not exist.']]);
        }

        $recorded = $db->select(
            'SELECT c.check_code, c.status, c.detail, c.checked_at, c.waived_reason, wu.name AS waived_by_name FROM period_close_checks c LEFT JOIN users wu ON wu.id = c.waived_by WHERE c.company_id = ? AND c.fiscal_period_id = ? ORDER BY c.check_code',
            [$companyId, $periodId],
        );
        $closed = in_array((string) $p->status, ['closed', 'locked'], true);
        if ($closed && $recorded !== []) {
            $checks = array_map(function (\stdClass $c): array {
                $detail = json_decode((string) $c->detail, true);

                return [
                    'code' => (string) $c->check_code, 'status' => (string) $c->status === 'pass' ? 'passed' : ((string) $c->status === 'waived' ? 'waived' : 'failed'),
                    'message' => is_array($detail) ? (string) ($detail['message'] ?? '') : '', 'checked_at' => (string) $c->checked_at,
                    'waived_by' => $c->waived_by_name === null ? null : (string) $c->waived_by_name, 'waived_reason' => $c->waived_reason === null ? null : (string) $c->waived_reason,
                ];
            }, $recorded);
            $source = 'recorded_at_close';
        } else {
            $period = FiscalPeriod::query()->where('company_id', $companyId)->findOrFail($periodId);
            $checks = array_map(fn ($o): array => [
                'code' => $o->code, 'status' => $o->passed ? 'passed' : 'failed', 'message' => $o->message, 'checked_at' => null, 'waived_by' => null, 'waived_reason' => null,
            ], ($this->preview)($period));
            $source = 'live';
        }

        $count = fn (string $s): int => count(array_filter($checks, fn (array $c): bool => $c['status'] === $s));

        return [
            'report' => 'period_close',
            'period' => [
                'id' => (string) $p->id, 'name' => (string) $p->name, 'kind' => (string) $p->kind, 'starts_on' => (string) $p->starts_on, 'ends_on' => (string) $p->ends_on,
                'status' => (string) $p->status, 'closed_at' => $p->closed_at === null ? null : (string) $p->closed_at, 'closed_by' => $p->closed_by_name === null ? null : (string) $p->closed_by_name,
            ],
            'source' => $source,
            'checks' => $checks,
            'summary' => ['passed' => $count('passed'), 'waived' => $count('waived'), 'failed' => $count('failed')],
        ];
    }
}
