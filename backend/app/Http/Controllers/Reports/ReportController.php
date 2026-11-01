<?php

declare(strict_types=1);

namespace App\Http\Controllers\Reports;

use App\Http\Controllers\Controller;
use App\Http\Requests\Reports\ReportRequest;
use App\Http\Support\CursorPage;
use App\Http\Support\Json;
use App\Models\Ledger\JournalLine;
use App\Models\Organisation\Company;
use App\Queries\Ledger\DimensionPositions;
use App\Queries\Reports\GeneralLedger;
use App\Queries\Reports\LedgerLines;
use App\Queries\Reports\LineFilter;
use App\Queries\Reports\ReportParamsResolver;
use App\Queries\Reports\RunReport;
use App\Support\Reports\Report;
use App\Support\Reports\ReportRunner;
use Illuminate\Http\JsonResponse;
use Illuminate\Routing\Attributes\Controllers\Authorize;

/**
 * Financial reports (13 §13). Statements are computed from `account_period_balances` where fiscal period
 * boundaries allow and from posted journal lines otherwise, on the reporting connection, and cached per
 * company by ledger_version. The ledger and the drill list journal lines, paged by cursor, every one
 * linking to its journal and source document.
 */
final class ReportController extends Controller
{
    #[Authorize('view', Report::class)]
    public function trialBalance(ReportRequest $request, Company $company, RunReport $report): JsonResponse
    {
        return response()->json(['data' => $report('trial-balance', $company, $request->validated())]);
    }

    #[Authorize('view', Report::class)]
    public function profitAndLoss(ReportRequest $request, Company $company, RunReport $report): JsonResponse
    {
        return response()->json(['data' => $report('profit-and-loss', $company, $request->validated())]);
    }

    #[Authorize('view', Report::class)]
    public function balanceSheet(ReportRequest $request, Company $company, RunReport $report): JsonResponse
    {
        return response()->json(['data' => $report('balance-sheet', $company, $request->validated())]);
    }

    #[Authorize('view', Report::class)]
    public function cashFlow(ReportRequest $request, Company $company, RunReport $report): JsonResponse
    {
        return response()->json(['data' => $report('cash-flow', $company, $request->validated())]);
    }

    #[Authorize('view', Report::class)]
    public function arAging(ReportRequest $request, Company $company, RunReport $report): JsonResponse
    {
        return response()->json(['data' => $report('ar-aging', $company, $request->validated())]);
    }

    #[Authorize('view', Report::class)]
    public function apAging(ReportRequest $request, Company $company, RunReport $report): JsonResponse
    {
        return response()->json(['data' => $report('ap-aging', $company, $request->validated())]);
    }

    #[Authorize('view', Report::class)]
    public function customerStatement(ReportRequest $request, Company $company, RunReport $report): JsonResponse
    {
        return response()->json(['data' => $report('customer-statement', $company, $request->validated())]);
    }

    #[Authorize('view', Report::class)]
    public function supplierStatement(ReportRequest $request, Company $company, RunReport $report): JsonResponse
    {
        return response()->json(['data' => $report('supplier-statement', $company, $request->validated())]);
    }

    #[Authorize('view', Report::class)]
    public function taxReturn(ReportRequest $request, Company $company, RunReport $report): JsonResponse
    {
        return response()->json(['data' => $report('tax-return', $company, $request->validated())]);
    }

    /** One account's ledger: header with opening and closing balance, then a page of lines with a running balance. */
    #[Authorize('view', Report::class)]
    public function generalLedger(ReportRequest $request, Company $company, ReportParamsResolver $params, GeneralLedger $ledger, LedgerLines $lines, ReportRunner $runner): JsonResponse
    {
        $p = $params->lines($company, $request->validated());
        $header = $runner->cached($company->id, 'general_ledger', $p->cacheKey(), fn (): array => ['generated_at' => gmdate('Y-m-d\TH:i:s\Z')] + $ledger->header($p));

        $page = CursorPage::fetch($lines->page($ledger->filter($p)), $request, 'journal_date', kind: 'date');
        $first = $page->items->first();
        $balance = $first instanceof JournalLine && $request->query('cursor') !== null && $request->query('cursor') !== ''
            ? $ledger->balanceBefore($p, $first)
            : (int) $header['opening_balance']['amount'];

        $account = $ledger->account($p);
        $positions = (new DimensionPositions)($company->id);
        $data = [];
        foreach ($page->items as $line) {
            /** @var JournalLine $line */
            $balance += $account->natural($line->debit, $line->credit);
            $data[] = $this->line($line, (string) $company->base_currency, $positions) + ['balance' => Json::money($balance, $company->base_currency)];
        }

        return response()->json(['data' => $data, 'meta' => $this->meta($page), 'report' => $header]);
    }

    /**
     * The journal lines behind one report cell. The drill key a cell carries is this request's query string;
     * `summary` totals every line of the cell, not just the page, and equals the cell's amount.
     */
    #[Authorize('view', Report::class)]
    public function drill(ReportRequest $request, Company $company, ReportParamsResolver $params, LedgerLines $lines, GeneralLedger $ledger, ReportRunner $runner): JsonResponse
    {
        $input = $request->validated();
        $p = $params->lines($company, $input);
        $account = $ledger->account($p);
        $filter = new LineFilter(
            $company->id, $account->id, $p->from, $p->to === GeneralLedger::OPEN_END ? null : $p->to,
            (bool) ($input['exclude_closing'] ?? false), $p->dims,
            ($input['contact_side'] ?? null) === 'debit' ? 'debit' : (($input['contact_side'] ?? null) === 'credit' ? 'credit' : null),
            isset($input['contact_id']) ? (string) $input['contact_id'] : null,
        );
        $cur = (string) $company->base_currency;

        $summary = $runner->cached($company->id, 'drill', $p->cacheKey() + ['exclude_closing' => $filter->excludeClosing, 'contact_side' => $filter->contactSide, 'contact_id' => $filter->contactId], function () use ($lines, $filter, $cur): array {
            $s = $lines->summary($filter);

            return [
                'debit' => Json::money($s['debit'], $cur), 'credit' => Json::money($s['credit'], $cur),
                'net' => Json::money($s['debit'] - $s['credit'], $cur), 'line_count' => $s['count'],
            ];
        });

        $page = CursorPage::fetch($lines->page($filter), $request, 'journal_date', kind: 'date');
        $positions = (new DimensionPositions)($company->id);
        $data = [];
        foreach ($page->items as $line) {
            /** @var JournalLine $line */
            $data[] = $this->line($line, $cur, $positions);
        }

        return response()->json([
            'data' => $data, 'meta' => $this->meta($page),
            'summary' => $summary, 'account' => $account->ref() + ['account_type' => $account->type],
        ]);
    }

    /**
     * @param  array<int, string>  $positions
     * @return array<string, mixed>
     */
    private function line(JournalLine $line, string $currency, array $positions): array
    {
        $dimensions = [];
        foreach ($positions as $slot => $dimensionId) {
            $value = $line->getAttribute("dim{$slot}_value_id");
            if (is_string($value)) {
                $dimensions[$dimensionId] = $value;
            }
        }

        return [
            'id' => $line->id,
            'journal' => [
                'id' => $line->journal_id,
                'number' => $line->getAttribute('journal_number'),
                'date' => $line->getAttribute('journal_date'),
                'type' => $line->getAttribute('journal_type'),
                'reference' => $line->getAttribute('journal_reference'),
                'memo' => $line->getAttribute('journal_memo'),
            ],
            'source' => $line->getAttribute('source_type') === null ? null : ['type' => $line->getAttribute('source_type'), 'id' => $line->getAttribute('source_id')],
            'line_no' => $line->line_no,
            'account_id' => $line->account_id,
            'debit' => Json::money($line->debit, $currency),
            'credit' => Json::money($line->credit, $currency),
            'description' => $line->description,
            'contact_id' => $line->contact_id,
            /** @var array<string, string> dimension id → dimension value id */
            'dimensions' => (object) $dimensions,
        ];
    }

    /** @return array{next_cursor: string|null, prev_cursor: string|null, limit: int} */
    private function meta(CursorPage $page): array
    {
        return ['next_cursor' => $page->nextCursor, 'prev_cursor' => $page->prevCursor, 'limit' => $page->limit];
    }
}
