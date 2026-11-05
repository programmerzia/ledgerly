<?php

declare(strict_types=1);

namespace App\Queries\Reports;

use App\Contracts\Clock;
use App\Models\Organisation\Company;
use App\Support\Reports\Dates;
use App\Support\Reports\ReportRunner;
use Illuminate\Validation\ValidationException;

/**
 * Turns validated request input into a ReportParams: a period or a date range, the month/ytd basis, the
 * comparison range and the dimension filter (dimension id → value ids, mapped to the eight line slots).
 */
final class ReportParamsResolver
{
    public function __construct(private readonly ReportRunner $runner, private readonly PeriodCalendar $calendar, private readonly Clock $clock) {}

    /**
     * A report over a range (profit and loss, cash flow): `period_id` with `basis` month|ytd, or `from` and `to`.
     *
     * @param  array<string, mixed>  $in
     */
    public function range(Company $company, array $in): ReportParams
    {
        $basis = (string) ($in['basis'] ?? 'month');
        $period = isset($in['period_id']) ? $this->period($company->id, (string) $in['period_id']) : null;
        if ($period !== null) {
            $from = $basis === 'ytd' ? $period->yearStartsOn : $period->startsOn;
            $to = $period->endsOn;
        } elseif (isset($in['from'], $in['to'])) {
            [$from, $to, $basis] = [(string) $in['from'], (string) $in['to'], 'range'];
        } else {
            throw $this->invalid('period_id', 'Give a period_id, or both from and to.');
        }

        $type = (string) ($in['comparison'] ?? 'none');
        $comparison = match ($type) {
            'previous_year' => $this->previousYearRange($company->id, $period, $basis, $from, $to),
            'previous_period' => $this->previousRange($company->id, $period, $basis, $from, $to),
            default => null,
        };

        return $this->build($company, $in, $from, $to, $basis, $type, $comparison, $period?->id);
    }

    /**
     * A report as of a date (trial balance, balance sheet): `as_of`, or `period_id` for its last day.
     *
     * @param  array<string, mixed>  $in
     */
    public function asOf(Company $company, array $in): ReportParams
    {
        $period = isset($in['period_id']) ? $this->period($company->id, (string) $in['period_id']) : null;
        $asOf = $period->endsOn ?? (isset($in['as_of']) ? (string) $in['as_of'] : $this->clock->now()->format('Y-m-d'));

        $type = (string) ($in['comparison'] ?? 'none');
        $comparison = null;
        if ($type === 'previous_year') {
            $containing = $period ?? $this->calendar->regularContaining($company->id, $asOf);
            $last = $containing !== null && $containing->weekBased ? $this->calendar->sameInPreviousYear($company->id, $containing) : null;
            $comparison = ['from' => null, 'to' => $last->endsOn ?? Dates::yearBefore($asOf)];
        } elseif ($type === 'previous_period') {
            $containing = $period ?? $this->calendar->regularContaining($company->id, $asOf);
            $previous = $containing === null ? null : $this->calendar->previousRegular($company->id, $containing);
            $comparison = $previous === null ? null : ['from' => null, 'to' => $previous->endsOn];
        }

        return $this->build($company, $in, null, $asOf, 'as_of', $type, $comparison, $period?->id);
    }

    /**
     * Lines of one account: an optional date range, no comparison.
     *
     * @param  array<string, mixed>  $in
     */
    public function lines(Company $company, array $in): ReportParams
    {
        $period = isset($in['period_id']) ? $this->period($company->id, (string) $in['period_id']) : null;
        $from = $period->startsOn ?? (isset($in['from']) ? (string) $in['from'] : null);
        $to = $period->endsOn ?? (isset($in['to']) ? (string) $in['to'] : '9999-12-31');

        return $this->build($company, $in, $from, $to, 'range', 'none', null, $period?->id);
    }

    /**
     * @param  array<string, mixed>  $in
     * @param  array{from: string|null, to: string}|null  $comparison
     */
    private function build(Company $company, array $in, ?string $from, string $to, string $basis, string $type, ?array $comparison, ?string $periodId): ReportParams
    {
        [$slots, $byId] = $this->dimensions($company->id, $in['dimensions'] ?? []);
        $breakdown = isset($in['breakdown']) ? $this->breakdown($company->id, (string) $in['breakdown']) : null;

        return new ReportParams(
            $company->id, (string) $company->base_currency, $from, $to, $basis, $type, $comparison, $slots, $byId,
            (bool) ($in['hide_zero'] ?? false), $periodId, isset($in['account_id']) ? (string) $in['account_id'] : null,
            isset($in['contact_id']) ? (string) $in['contact_id'] : null,
            $breakdown['slot'] ?? null, $breakdown['id'] ?? null,
        );
    }

    /** @return array{slot: int, id: string} */
    private function breakdown(string $companyId, string $dimensionId): array
    {
        $row = $this->runner->db()->selectOne('SELECT id, position FROM dimensions WHERE company_id = ? AND id = ?', [$companyId, $dimensionId]);
        if ($row === null) {
            throw $this->invalid('breakdown', 'The dimension does not exist.');
        }

        return ['slot' => (int) $row->position, 'id' => (string) $row->id];
    }

    /**
     * "Last year" for a range report. Calendar months: the same dates a year earlier. A week-based year: the same period of the previous
     * fiscal year (or its year to date), because its periods do not fall on the same dates; with no previous year, the dates shift as before.
     *
     * @return array{from: string, to: string}
     */
    private function previousYearRange(string $companyId, ?CalendarPeriod $period, string $basis, string $from, string $to): array
    {
        $last = $period !== null && $period->weekBased ? $this->calendar->sameInPreviousYear($companyId, $period) : null;
        if ($last === null) {
            return ['from' => Dates::yearBefore($from), 'to' => Dates::yearBefore($to)];
        }

        return ['from' => $basis === 'ytd' ? $last->yearStartsOn : $last->startsOn, 'to' => $last->endsOn];
    }

    /** @return array{from: string|null, to: string}|null */
    private function previousRange(string $companyId, ?CalendarPeriod $period, string $basis, string $from, string $to): ?array
    {
        if ($period === null) {
            // A custom range is compared with the range of the same length right before it.
            $days = Dates::days($from, $to) + 1;

            return ['from' => Dates::make($from)->modify("-{$days} days")->format('Y-m-d'), 'to' => Dates::before($from)];
        }
        $previous = $this->calendar->previousRegular($companyId, $period);
        if ($previous === null) {
            return null;
        }
        if ($basis === 'ytd') {
            // Year to date up to the month before; the first month of a year has nothing to compare with.
            return $previous->endsOn < $from ? null : ['from' => $from, 'to' => $previous->endsOn];
        }

        return ['from' => $previous->startsOn, 'to' => $previous->endsOn];
    }

    private function period(string $companyId, string $id): CalendarPeriod
    {
        return $this->calendar->find($companyId, $id) ?? throw $this->invalid('period_id', 'The period does not exist.');
    }

    /**
     * @return array{0: array<int, list<string>>, 1: array<string, list<string>>}
     */
    private function dimensions(string $companyId, mixed $input): array
    {
        if (! is_array($input) || $input === []) {
            return [[], []];
        }
        $db = $this->runner->db();
        /** @var array<string, int> $slots */
        $slots = [];
        foreach ($db->select('SELECT id, position FROM dimensions WHERE company_id = ?', [$companyId]) as $r) {
            $slots[(string) $r->id] = (int) $r->position;
        }

        $bySlot = [];
        $byId = [];
        foreach ($input as $dimensionId => $values) {
            $dimensionId = (string) $dimensionId;
            $ids = array_values(array_unique(array_map(strval(...), is_array($values) ? $values : [$values])));
            if (! isset($slots[$dimensionId])) {
                throw $this->invalid("dimensions.{$dimensionId}", 'The dimension does not exist.');
            }
            $known = $db->select(
                'SELECT id FROM dimension_values WHERE company_id = ? AND dimension_id = ? AND id IN ('.implode(', ', array_fill(0, count($ids), '?')).')',
                [$companyId, $dimensionId, ...$ids],
            );
            if (count($known) !== count($ids)) {
                throw $this->invalid("dimensions.{$dimensionId}", 'A value does not belong to this dimension.');
            }
            sort($ids);
            $bySlot[$slots[$dimensionId]] = $ids;
            $byId[$dimensionId] = $ids;
        }
        ksort($byId);

        return [$bySlot, $byId];
    }

    private function invalid(string $field, string $message): ValidationException
    {
        return ValidationException::withMessages([$field => [$message]]);
    }
}
