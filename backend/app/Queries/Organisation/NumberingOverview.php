<?php

declare(strict_types=1);

namespace App\Queries\Organisation;

use App\Contracts\Clock;
use App\Domain\Organisation\NumberingKinds;
use App\Models\Fiscal\FiscalYear;
use App\Models\Organisation\NumberingRule;
use Illuminate\Support\Facades\DB;

/**
 * Where numbering stands for a company: per document kind, the prefix and padding the current fiscal year uses, the change waiting for
 * a later year (if any) and how many numbers the current year has issued. Also the rule a change made today would get
 * (`effectiveFrom`): the first fiscal year after the current one whose sequence for the kind does not exist yet.
 */
final class NumberingOverview
{
    public function __construct(private readonly Clock $clock) {}

    /** @return array<string, mixed> */
    public function __invoke(string $companyId): array
    {
        $current = $this->currentYear($companyId);
        $rules = NumberingRule::query()->where('company_id', $companyId)->orderBy('effective_from')->get()->groupBy('doc_kind');
        $anchor = $current?->starts_on->format('Y-m-d') ?? $this->clock->now()->format('Y-m-d');
        $years = FiscalYear::query()->where('company_id', $companyId)->orderBy('starts_on')->get();

        $issued = [];
        if ($current !== null) {
            foreach (DB::table('sequences')->where('company_id', $companyId)->where('sequence_key', 'like', '%:'.$current->name)->get(['sequence_key', 'next_value', 'prefix', 'padding']) as $s) {
                $issued[(string) $s->sequence_key] = $s;
            }
        }

        $kinds = [];
        foreach (NumberingKinds::KINDS as $kind => $meta) {
            $own = $rules->get($kind)?->all() ?? [];
            $inForce = null;
            $pending = null;
            foreach ($own as $rule) {
                $from = $rule->effective_from->format('Y-m-d');
                if ($from <= $anchor) {
                    $inForce = $rule;
                } else {
                    $pending = $rule;
                }
            }
            $yearName = $current->name ?? 'YEAR';
            $seq = $current === null ? null : ($issued[NumberingKinds::sequenceKey($kind, $current->name)] ?? null);
            $prefix = $inForce->prefix ?? $meta['prefix'];
            $padding = $inForce->padding ?? NumberingKinds::DEFAULT_PADDING;
            $pendingFrom = $pending?->effective_from->format('Y-m-d');

            $kinds[] = [
                'kind' => $kind,
                'label' => $meta['label'],
                'default_prefix' => $meta['prefix'],
                'prefix' => $prefix,
                'padding' => $padding,
                // What the current year really uses: its sequence's own settings once it exists.
                'current_year_sequence' => $seq === null ? null : [
                    'prefix' => rtrim((string) $seq->prefix, '-'), 'padding' => (int) $seq->padding, 'issued' => max(0, (int) $seq->next_value - 1),
                ],
                'example' => NumberingKinds::example($prefix, $padding, $yearName),
                'pending' => $pending === null ? null : [
                    'prefix' => $pending->prefix, 'padding' => $pending->padding, 'effective_from' => $pendingFrom,
                    'fiscal_year' => $years->first(fn (FiscalYear $y) => $y->starts_on->format('Y-m-d') >= $pendingFrom)?->name,
                    'version' => $pending->lock_version,
                    'example' => NumberingKinds::example($pending->prefix, $pending->padding, $years->first(fn (FiscalYear $y) => $y->starts_on->format('Y-m-d') >= $pendingFrom)->name ?? 'YEAR'),
                ],
                'next_change_from' => $this->effectiveFrom($companyId, $kind, $current, $years->values()->all())['from'],
            ];
        }

        return [
            'current_fiscal_year' => $current === null ? null : ['id' => $current->id, 'name' => $current->name, 'starts_on' => $current->starts_on->format('Y-m-d'), 'ends_on' => $current->ends_on->format('Y-m-d')],
            'kinds' => $kinds,
        ];
    }

    public function currentYear(string $companyId): ?FiscalYear
    {
        $today = $this->clock->now()->format('Y-m-d');

        return FiscalYear::query()->where('company_id', $companyId)->where('starts_on', '<=', $today)->where('ends_on', '>=', $today)->first();
    }

    /**
     * The date from which a rule changed now takes effect: the start of the first fiscal year after the current one that has no sequence
     * for this kind yet. With no such year yet created, the day after the latest year ends (or after today when there is no current year).
     *
     * @param  array<int, FiscalYear>  $years  the company's years by start date
     * @return array{from: string, fiscal_year: string|null}
     */
    public function effectiveFrom(string $companyId, string $kind, ?FiscalYear $current, array $years): array
    {
        $after = $current?->ends_on->format('Y-m-d') ?? $this->clock->now()->format('Y-m-d');
        $later = array_values(array_filter($years, fn (FiscalYear $y) => $y->starts_on->format('Y-m-d') > $after));
        foreach ($later as $year) {
            $exists = DB::table('sequences')->where('company_id', $companyId)->where('sequence_key', NumberingKinds::sequenceKey($kind, $year->name))->exists();
            if (! $exists) {
                return ['from' => $year->starts_on->format('Y-m-d'), 'fiscal_year' => $year->name];
            }
        }
        $last = $later === [] ? $after : end($later)->ends_on->format('Y-m-d');

        return ['from' => (new \DateTimeImmutable($last))->modify('+1 day')->format('Y-m-d'), 'fiscal_year' => null];
    }
}
