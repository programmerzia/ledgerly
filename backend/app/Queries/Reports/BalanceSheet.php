<?php

declare(strict_types=1);

namespace App\Queries\Reports;

use App\Http\Support\Json;
use App\Support\Reports\ReportRunner;

/**
 * Balance sheet as of a date. Closing journals are included, so after a year-end close the result of the
 * year sits in retained earnings. Before the close the unclosed result of income and expense accounts is
 * shown as equity: "Current year result" (the fiscal year of the date, to date) and "Prior years' result
 * (not yet closed)" for whatever earlier years have not been closed. Assets = liabilities + equity always.
 *
 * Amounts are in each account's own direction (assets by debit, liabilities and equity by credit).
 *
 * D9: customer credit balances and supplier debit balances are not netted into the control accounts. The
 * receivable control account shows only contacts that owe us; contacts in credit appear as a liability
 * ("Customer credit balances"). The payable control account shows only what we owe; suppliers in debit
 * appear as an asset ("Supplier debit balances"). Each of those lines lists its contacts.
 *
 * D13: when the company has a dimension with the code `FUND`, equity lines and the result are split by its
 * values (no value = unrestricted) and `equity.funds` totals each fund.
 */
final class BalanceSheet
{
    private const string NONE = '';

    public function __construct(
        private readonly LedgerBalances $balances,
        private readonly AccountDirectory $accounts,
        private readonly PeriodCalendar $calendar,
        private readonly ReportRunner $runner,
    ) {}

    /** @return array<string, mixed> */
    public function __invoke(ReportParams $p): array
    {
        $fund = $this->fundDimension($p->companyId);
        $slot = $fund['slot'] ?? null;
        $current = $this->column($p, $p->to, $slot);
        $compare = $p->comparisonRange !== null;
        $previous = $compare ? $this->column($p, (string) $p->comparisonRange['to'], $slot) : null;
        $cur = $p->currency;

        $sections = ['assets' => [], 'liabilities' => [], 'equity' => []];
        foreach (array_keys($sections) as $section) {
            $keys = array_keys($current[$section] + ($previous[$section] ?? []));
            foreach ($keys as $key) {
                $now = $current[$section][$key] ?? null;
                $before = $previous[$section][$key] ?? null;
                $cell = $now ?? $before;
                if ($cell === null) {
                    continue;
                }
                $meta = $cell['meta'];
                $amount = $now['amount'] ?? 0;
                $prior = $before['amount'] ?? 0;
                if ($amount === 0 && $prior === 0 && ($p->hideZero || ! ($meta['postable'] ?? true))) {
                    continue;
                }
                unset($meta['postable']);
                $line = $meta + ['amount' => Json::money($amount, $cur)];
                if ($compare) {
                    $line += Variance::of($amount, $prior, $cur);
                }
                $sections[$section][] = ['sort' => (string) ($meta['sort'] ?? ''), 'line' => $line, 'amount' => $amount, 'prior' => $prior, 'group' => $meta['fund']['id'] ?? self::NONE];
            }
            usort($sections[$section], fn (array $a, array $b) => strcmp($a['sort'], $b['sort']));
        }

        $totals = [];
        $priorTotals = [];
        foreach ($sections as $name => $entries) {
            $totals[$name] = array_sum(array_column($entries, 'amount'));
            $priorTotals[$name] = array_sum(array_column($entries, 'prior'));
        }
        $figure = fn (int $a, int $b): array => ['amount' => Json::money($a, $cur)] + ($compare ? Variance::of($a, $b, $cur) : []);
        $lines = fn (string $s): array => array_map(function (array $e): array {
            unset($e['line']['sort']);

            return $e['line'];
        }, $sections[$s]);

        $equity = ['lines' => $lines('equity'), 'total' => $figure($totals['equity'], $priorTotals['equity'])];
        if ($fund !== null) {
            $equity['funds'] = $this->funds($sections['equity'], $fund, $figure);
        }
        $difference = $totals['assets'] - $totals['liabilities'] - $totals['equity'];

        return [
            'report' => 'balance_sheet',
            'currency' => $cur,
            'as_of' => $p->to,
            'comparison' => $p->comparison === 'none' ? null : [
                'type' => $p->comparison, 'available' => $compare, 'as_of' => $p->comparisonRange['to'] ?? null,
            ],
            'assets' => ['lines' => $lines('assets'), 'total' => $figure($totals['assets'], $priorTotals['assets'])],
            'liabilities' => ['lines' => $lines('liabilities'), 'total' => $figure($totals['liabilities'], $priorTotals['liabilities'])],
            'equity' => $equity,
            'totals' => [
                'liabilities_and_equity' => $figure($totals['liabilities'] + $totals['equity'], $priorTotals['liabilities'] + $priorTotals['equity']),
            ],
            'balanced' => $difference === 0,
            'difference' => Json::money($difference, $cur),
            'filtered' => $p->dims !== [],
        ];
    }

    /**
     * One date's figures, as cells keyed by section then line.
     *
     * @return array{assets: array<string, array{meta: array<string, mixed>, amount: int}>, liabilities: array<string, array{meta: array<string, mixed>, amount: int}>, equity: array<string, array{meta: array<string, mixed>, amount: int}>}
     */
    private function column(ReportParams $p, string $asOf, ?int $fundSlot): array
    {
        $accounts = $this->accounts->all($p->companyId);
        $funds = $fundSlot === null ? [] : $this->fundValues($p->companyId);
        $fundOf = fn (string $group): ?array => $group === self::NONE ? null : ($funds[$group] ?? ['id' => $group, 'code' => '', 'name' => '']);

        /** @var array<string, array<string, int>> $balance account → group → debit − credit */
        $balance = [];
        /** @var array<string, int> $result group → credit − debit of income and expense accounts, closing included */
        $result = [];
        foreach ($this->balances->totals($p->companyId, null, $asOf, false, $p->dims, $fundSlot) as $row) {
            $a = $accounts[$row->accountId] ?? null;
            if ($a === null) {
                continue;
            }
            $group = $row->group ?? self::NONE;
            if (in_array($a->type, ['income', 'expense'], true)) {
                $result[$group] = ($result[$group] ?? 0) + $row->credit - $row->debit;
            } else {
                $balance[$a->id][$group] = ($balance[$a->id][$group] ?? 0) + $row->debit - $row->credit;
            }
        }

        // The fiscal year of the date, to date (closing included: zero once the year is closed).
        $yearStart = $this->calendar->yearStart($p->companyId, $asOf);
        $currentResult = [];
        if ($yearStart !== null) {
            $incomeExpense = array_keys(array_filter($accounts, fn (AccountInfo $a) => in_array($a->type, ['income', 'expense'], true)));
            foreach ($this->balances->totals($p->companyId, $yearStart, $asOf, false, $p->dims, $fundSlot, accountIds: $incomeExpense) as $row) {
                $group = $row->group ?? self::NONE;
                $currentResult[$group] = ($currentResult[$group] ?? 0) + $row->credit - $row->debit;
            }
        }

        $cells = ['assets' => [], 'liabilities' => [], 'equity' => []];
        $contacts = $this->contactSplits($p, $asOf, $accounts, $balance);

        foreach ($balance as $accountId => $byGroup) {
            $a = $accounts[$accountId];
            $split = $contacts[$a->id] ?? null;
            $meta = ['key' => $a->id, 'account' => $a->ref() + ['subtype' => $a->subtype], 'sort' => $a->code, 'postable' => $a->postable,
                'drill' => DrillKey::make($a->id, null, $asOf, false, $p->dimensionIds, $split !== null && $split['moved'] !== 0 ? $split['kept_side'] : null)];

            if ($a->type === 'equity') {
                foreach ($byGroup as $group => $net) {
                    $key = "{$a->id}:{$group}";
                    $line = $meta;
                    if ($fundSlot !== null) {
                        $line['fund'] = $fundOf((string) $group);
                        $line['key'] = $key;
                    }
                    $cells['equity'][$key] = ['meta' => $line, 'amount' => -$net];
                }

                continue;
            }
            $net = array_sum($byGroup);
            $amount = $a->type === 'asset' ? $net : -$net;
            if ($split !== null) {
                $amount = $split['kept'];   // D9: only the contacts on this account's own side
            }
            $cells[$a->type === 'asset' ? 'assets' : 'liabilities'][$a->id] = ['meta' => $meta, 'amount' => $amount];
        }
        // Accounts with no activity still appear (zero) so a comparison column can line up and hide_zero can decide.
        foreach ($accounts as $a) {
            $section = match ($a->type) {
                'asset' => 'assets',
                'liability' => 'liabilities',
                'equity' => 'equity',
                default => null,
            };
            if ($section === null || $section === 'equity' || isset($cells[$section][$a->id])) {
                continue;
            }
            $cells[$section][$a->id] = ['meta' => ['key' => $a->id, 'account' => $a->ref() + ['subtype' => $a->subtype], 'sort' => $a->code, 'postable' => $a->postable,
                'drill' => DrillKey::make($a->id, null, $asOf, false, $p->dimensionIds)], 'amount' => 0];
        }

        // D9: the other side of each control account is its own line, with the contacts that make it up.
        foreach ($contacts as $accountId => $split) {
            if ($split['moved'] === 0) {
                continue;
            }
            $a = $accounts[$accountId];
            $isAr = $a->normalBalance === 'debit';
            $section = $isAr ? 'liabilities' : 'assets';
            $key = ($isAr ? 'customer_credit_balances:' : 'supplier_debit_balances:').$a->id;
            $cells[$section][$key] = ['amount' => $split['moved'], 'meta' => [
                'key' => $key,
                'name' => $isAr ? 'Customer credit balances' : 'Supplier debit balances',
                'account' => $a->ref() + ['subtype' => $a->subtype],
                'sort' => $a->code.'~',
                'postable' => true,
                'gross' => true,
                'contacts' => $split['contacts'],
                'drill' => DrillKey::make($a->id, null, $asOf, false, $p->dimensionIds, $split['moved_side']),
            ]];
        }

        // Unclosed result as equity.
        $fundGroups = array_unique([...array_keys($result), ...array_keys($currentResult)]);
        sort($fundGroups);
        foreach ($fundGroups as $group) {
            $group = (string) $group;
            $now = $currentResult[$group] ?? 0;
            $prior = ($result[$group] ?? 0) - $now;
            foreach ([['current_year_result', 'Current year result', $now, '~1'], ['prior_years_result', "Prior years' result (not yet closed)", $prior, '~2']] as [$k, $name, $amount, $sort]) {
                $key = $k.':'.$group;
                $meta = ['key' => $key, 'name' => $name, 'sort' => '~'.$sort.$group, 'postable' => true, 'result' => true,
                    'report' => ['report' => 'profit_and_loss', 'to' => $asOf]];
                if ($fundSlot !== null) {
                    $meta['fund'] = $fundOf($group);
                }
                $cells['equity'][$key] = ['meta' => $meta, 'amount' => $amount];
            }
        }

        return $cells;
    }

    /**
     * D9 split of each receivable/payable control account that has contacts on both sides.
     *
     * @param  array<string, AccountInfo>  $accounts
     * @param  array<string, array<string, int>>  $balance
     * @return array<string, array{kept: int, kept_side: string, moved: int, moved_side: string, contacts: list<array<string, mixed>>}>
     */
    private function contactSplits(ReportParams $p, string $asOf, array $accounts, array $balance): array
    {
        $controls = array_keys(array_filter($accounts, fn (AccountInfo $a) => in_array($a->controlType, ['ar', 'ap'], true) && isset($balance[$a->id])));
        if ($controls === []) {
            return [];
        }
        /** @var array<string, array<string, int>> $perContact account → contact ('' = none) → debit − credit */
        $perContact = [];
        foreach ($this->balances->contactTotals($p->companyId, $asOf, $controls, $p->dims) as $r) {
            $perContact[$r['account_id']][$r['contact_id'] ?? ''] = $r['debit'] - $r['credit'];
        }

        $contactIds = [];
        foreach ($perContact as $byContact) {
            foreach (array_keys($byContact) as $id) {
                if ($id !== '') {
                    $contactIds[(string) $id] = (string) $id;
                }
            }
        }
        $names = $this->contactNames($p->companyId, array_values($contactIds));
        $out = [];
        foreach ($perContact as $accountId => $byContact) {
            $a = $accounts[$accountId];
            $isAr = $a->controlType === 'ar';
            $kept = 0;
            $moved = 0;
            $list = [];
            foreach ($byContact as $contactId => $net) {
                $own = $isAr ? $net : -$net;   // positive: on the account's own side
                if ($own >= 0) {
                    $kept += $own;

                    continue;
                }
                $moved += -$own;
                $contactId = (string) $contactId;
                $list[] = [
                    'contact' => $contactId === '' ? null : ['id' => $contactId, 'name' => $names[$contactId] ?? ''],
                    'amount' => Json::money(-$own, $p->currency),
                    'drill' => DrillKey::make($accountId, null, $asOf, false, $p->dimensionIds, null, $contactId === '' ? null : $contactId),
                ];
            }
            usort($list, fn (array $x, array $y) => strcmp((string) ($x['contact']['name'] ?? ''), (string) ($y['contact']['name'] ?? '')));
            $out[$accountId] = [
                'kept' => $kept, 'kept_side' => $isAr ? 'debit' : 'credit',
                'moved' => $moved, 'moved_side' => $isAr ? 'credit' : 'debit', 'contacts' => $list,
            ];
        }

        return $out;
    }

    /**
     * @param  list<string>  $ids
     * @return array<string, string>
     */
    private function contactNames(string $companyId, array $ids): array
    {
        if ($ids === []) {
            return [];
        }
        $out = [];
        $rows = $this->runner->db()->select('SELECT id, name FROM contacts WHERE company_id = ? AND id IN ('.implode(', ', array_fill(0, count($ids), '?')).')', [$companyId, ...$ids]);
        foreach ($rows as $r) {
            $out[(string) $r->id] = (string) $r->name;
        }

        return $out;
    }

    /** @return array{id: string, slot: int}|null */
    private function fundDimension(string $companyId): ?array
    {
        $row = $this->runner->db()->selectOne("SELECT id, position FROM dimensions WHERE company_id = ? AND lower(code) = 'fund'", [$companyId]);

        return $row === null ? null : ['id' => (string) $row->id, 'slot' => (int) $row->position];
    }

    /** @return array<string, array{id: string, code: string, name: string}> */
    private function fundValues(string $companyId): array
    {
        $out = [];
        $rows = $this->runner->db()->select(
            "SELECT v.id, v.code, v.name FROM dimension_values v JOIN dimensions d ON d.id = v.dimension_id WHERE v.company_id = ? AND lower(d.code) = 'fund'",
            [$companyId],
        );
        foreach ($rows as $r) {
            $out[(string) $r->id] = ['id' => (string) $r->id, 'code' => (string) $r->code, 'name' => (string) $r->name];
        }

        return $out;
    }

    /**
     * Equity per fund: the sum of the equity lines (accounts and unclosed result) of each fund value.
     *
     * @param  list<array{sort: string, line: array<string, mixed>, amount: int, prior: int, group: string}>  $entries
     * @param  array{id: string, slot: int}  $fund
     * @param  callable(int, int): array<string, mixed>  $figure
     * @return list<array<string, mixed>>
     */
    private function funds(array $entries, array $fund, callable $figure): array
    {
        $byGroup = [];
        foreach ($entries as $e) {
            $g = $e['group'];
            $byGroup[$g] = ['fund' => $e['line']['fund'] ?? null, 'amount' => ($byGroup[$g]['amount'] ?? 0) + $e['amount'], 'prior' => ($byGroup[$g]['prior'] ?? 0) + $e['prior']];
        }
        ksort($byGroup);

        return array_values(array_map(fn (array $g) => ['fund' => $g['fund'], 'total' => $figure($g['amount'], $g['prior'])], $byGroup));
    }
}
