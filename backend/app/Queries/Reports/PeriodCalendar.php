<?php

declare(strict_types=1);

namespace App\Queries\Reports;

use App\Support\Reports\Dates;
use App\Support\Reports\ReportRunner;

/** The company's fiscal periods, read once per request from the reporting connection. */
final class PeriodCalendar
{
    /** @var array<string, list<CalendarPeriod>> */
    private array $cache = [];

    public function __construct(private readonly ReportRunner $runner) {}

    /** @return list<CalendarPeriod> ordered by start date, regular periods before the adjustment period of the same day */
    public function periods(string $companyId): array
    {
        if (isset($this->cache[$companyId])) {
            return $this->cache[$companyId];
        }
        $rows = $this->runner->db()->select(
            'SELECT p.id, p.fiscal_year_id, p.number, p.name, p.kind, p.starts_on, p.ends_on, y.starts_on AS year_starts_on, y.ends_on AS year_ends_on
             FROM fiscal_periods p JOIN fiscal_years y ON y.id = p.fiscal_year_id
             WHERE p.company_id = ? ORDER BY p.starts_on, p.number',
            [$companyId],
        );
        $periods = [];
        foreach ($rows as $r) {
            $periods[] = new CalendarPeriod(
                (string) $r->id, (string) $r->fiscal_year_id, (int) $r->number, (string) $r->name, (string) $r->kind,
                (string) $r->starts_on, (string) $r->ends_on, (string) $r->year_starts_on, (string) $r->year_ends_on,
            );
        }

        return $this->cache[$companyId] = $periods;
    }

    public function find(string $companyId, string $periodId): ?CalendarPeriod
    {
        foreach ($this->periods($companyId) as $p) {
            if ($p->id === $periodId) {
                return $p;
            }
        }

        return null;
    }

    /** The regular period that contains the date. */
    public function regularContaining(string $companyId, string $date): ?CalendarPeriod
    {
        foreach ($this->periods($companyId) as $p) {
            if ($p->isRegular() && $p->startsOn <= $date && $p->endsOn >= $date) {
                return $p;
            }
        }

        return null;
    }

    /** The regular period that ends the day before this one starts. */
    public function previousRegular(string $companyId, CalendarPeriod $period): ?CalendarPeriod
    {
        $end = Dates::before($period->startsOn);
        foreach ($this->periods($companyId) as $p) {
            if ($p->isRegular() && $p->endsOn === $end) {
                return $p;
            }
        }

        return null;
    }

    /** First day of the fiscal year that contains the date, or null when no fiscal year does. */
    public function yearStart(string $companyId, string $date): ?string
    {
        foreach ($this->periods($companyId) as $p) {
            if ($p->yearStartsOn <= $date && $p->yearEndsOn >= $date) {
                return $p->yearStartsOn;
            }
        }

        return null;
    }
}
