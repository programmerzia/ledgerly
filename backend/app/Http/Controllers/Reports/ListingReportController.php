<?php

declare(strict_types=1);

namespace App\Http\Controllers\Reports;

use App\Domain\Shared\DomainRuleViolation;
use App\Http\Controllers\Controller;
use App\Http\Requests\Reports\ReportRequest;
use App\Http\Support\CursorPage;
use App\Http\Support\RequestActor;
use App\Models\Audit\AuditEvent;
use App\Models\Banking\BankReconciliation;
use App\Models\Ledger\Journal;
use App\Models\Organisation\Company;
use App\Queries\Banking\BankReconciliationReport;
use App\Queries\Reports\ArApAging;
use App\Queries\Reports\JournalList;
use App\Queries\Reports\PeriodCloseChecklist;
use App\Queries\Reports\ReportParamsResolver;
use App\Queries\Reports\TaxReturn;
use App\Support\Audit\AuditBundle;
use App\Support\Audit\DetachedAudit;
use App\Support\Reports\Report;
use Illuminate\Http\JsonResponse;
use Illuminate\Routing\Attributes\Controllers\Authorize;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

/**
 * Listing and document reports (3c.20): the journal list, the bank reconciliation report, the period close checklist and
 * the tamper-evident audit bundle. Their exports go through `ReportExportController` like every report.
 */
final class ListingReportController extends Controller
{
    /** Journals, newest last, with totals and optionally lines; `choices` offers the filter its sources and people. */
    #[Authorize('view', Report::class)]
    public function journalList(ReportRequest $request, Company $company, JournalList $list): JsonResponse
    {
        $input = $request->validated();
        $page = CursorPage::fetch($list->page($company->id, $input), $request, 'journal_date', kind: 'date');
        $withChoices = $request->query('cursor') === null || $request->query('cursor') === '';

        return response()->json($list->payload($company->id, (string) $company->base_currency, $page->items->all(), (bool) ($input['include_lines'] ?? false), $withChoices)
            + ['meta' => ['next_cursor' => $page->nextCursor, 'prev_cursor' => $page->prevCursor, 'limit' => $page->limit]]);
    }

    /** The documents behind a receivables aging cell (`bucket`, optionally one `contact_id`); their amounts add up to the cell. */
    #[Authorize('view', Report::class)]
    public function arAgingDocuments(ReportRequest $request, Company $company, ReportParamsResolver $params, ArApAging $aging): JsonResponse
    {
        return response()->json(['data' => $aging->documents($params->asOf($company, $request->validated()), true, (string) ($request->validated('bucket') ?? 'open'), $request->validated('contact_id'))]);
    }

    /** The same for payables. */
    #[Authorize('view', Report::class)]
    public function apAgingDocuments(ReportRequest $request, Company $company, ReportParamsResolver $params, ArApAging $aging): JsonResponse
    {
        return response()->json(['data' => $aging->documents($params->asOf($company, $request->validated()), false, (string) ($request->validated('bucket') ?? 'open'), $request->validated('contact_id'))]);
    }

    /** The documents behind one row of the tax return (`side`, `tax_code_id`) in the period; their nets and taxes add up to the row. */
    #[Authorize('view', Report::class)]
    public function taxReturnDocuments(ReportRequest $request, Company $company, ReportParamsResolver $params, TaxReturn $return): JsonResponse
    {
        $input = $request->validated();
        if (! isset($input['side'], $input['tax_code_id'])) {
            throw ValidationException::withMessages(['side' => ['Give the side (sales or purchases) and the tax code of the row.']]);
        }

        return response()->json(['data' => $return->documents($params->range($company, $input), (string) $input['side'], (string) $input['tax_code_id'])]);
    }

    /** One finished reconciliation: the proof, statement against books, unmatched and excluded items. */
    #[Authorize('view', 'bankReconciliation')]
    public function bankReconciliation(Company $company, BankReconciliation $bankReconciliation, BankReconciliationReport $report): JsonResponse
    {
        return response()->json(['data' => $report($company->id, $bankReconciliation->id)]);
    }

    /** A period's close checks: as recorded when it closed, or as they stand now. */
    #[Authorize('view', Report::class)]
    public function periodClose(ReportRequest $request, Company $company, PeriodCloseChecklist $checklist): JsonResponse
    {
        $periodId = $request->validated('period_id');
        if (! is_string($periodId)) {
            throw ValidationException::withMessages(['period_id' => ['Choose a period.']]);
        }

        return response()->json(['data' => $checklist($company->id, $periodId)]);
    }

    /**
     * The audit events the filters select as a zip an auditor can verify without Ledgerly (README and verify.py inside). Needs
     * the audit log and the export permissions and, as ADR-0004 asks of an audit export, the signing PIN; people only. Audited
     * like every export; one hour's limit is the `report-exports` limiter's.
     */
    #[Authorize('viewAny', AuditEvent::class)]
    public function auditBundle(ReportRequest $request, Company $company, AuditBundle $bundle, DetachedAudit $audit): BinaryFileResponse
    {
        Gate::authorize('export', Report::class);
        $actor = RequestActor::user($request, $company->id);
        if (! $actor->hasSigningGrant) {
            throw DomainRuleViolation::single('signature_required', 'Exporting the audit trail needs your signing PIN.');
        }
        $input = $request->validated();
        $filters = array_intersect_key($input, array_flip(['from', 'to', 'action', 'actor_id', 'subject_type', 'subject_id']));

        $built = $bundle->build($company->id, $company->name, $filters, $actor->id, gmdate('Y-m-d\TH:i:s\Z'));
        $audit->record($actor, 'report.exported', null, [
            'report' => 'audit-trail-bundle', 'format' => 'zip', 'rows' => $built['entries'], 'events' => $built['events'], 'delivery' => 'inline', 'parameters' => $filters,
        ]);

        return response()->download($built['path'], 'audit-evidence-'.gmdate('Ymd').'.zip', ['Content-Type' => 'application/zip', 'X-Content-Type-Options' => 'nosniff'])->deleteFileAfterSend(true);
    }
}
