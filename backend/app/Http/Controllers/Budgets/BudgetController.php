<?php

declare(strict_types=1);

namespace App\Http\Controllers\Budgets;

use App\Actions\Budgets\ApproveBudget;
use App\Actions\Budgets\ManageBudget;
use App\Actions\Budgets\SaveBudgetLines;
use App\Http\Controllers\Controller;
use App\Http\Requests\Budgets\BudgetLinesRequest;
use App\Http\Requests\Budgets\BudgetQueryRequest;
use App\Http\Requests\Budgets\BudgetRequest;
use App\Http\Requests\VersionRequest;
use App\Http\Resources\BudgetResource;
use App\Http\Resources\FreeFormDataResource;
use App\Http\Support\RequestActor;
use App\Models\Budgets\Budget;
use App\Models\Organisation\Company;
use App\Queries\Budgets\BudgetGrid;
use App\Services\Budgets\BudgetExport;
use App\Support\Audit\DetachedAudit;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Routing\Attributes\Controllers\Authorize;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\Response;

/** Budget versions and their grid (`budgets.view|manage|approve`; people only). Nothing here posts or bumps the ledger version. */
final class BudgetController extends Controller
{
    #[Authorize('viewAny', Budget::class)]
    public function index(BudgetQueryRequest $request, Company $company): AnonymousResourceCollection
    {
        $query = Budget::query()->where('company_id', $company->id)->with('fiscalYear')->withCount('lines')
            ->orderByDesc('fiscal_year_id')->orderByDesc('version');
        if ($request->fiscalYearId() !== null) {
            $query->where('fiscal_year_id', $request->fiscalYearId());
        }

        return BudgetResource::collection($query->get());
    }

    #[Authorize('view', 'budget')]
    public function show(Company $company, Budget $budget, BudgetGrid $grid): JsonResponse
    {
        $this->own($company, $budget);

        return response()->json(['data' => $this->resource($budget)->resolve()] + ['grid' => $grid($budget)]);
    }

    #[Authorize('create', Budget::class)]
    public function store(BudgetRequest $request, Company $company, ManageBudget $action): JsonResponse
    {
        $budget = $action->create(RequestActor::user($request, $company->id), $company->id, $request->fiscalYearId(), $request->name(), $request->copyFrom());

        return $this->resource($budget)->response()->setStatusCode(201);
    }

    #[Authorize('update', 'budget')]
    public function update(BudgetRequest $request, Company $company, Budget $budget, ManageBudget $action): BudgetResource
    {
        $this->own($company, $budget);

        return $this->resource($action->rename(RequestActor::user($request, $company->id), $budget->id, $request->version(), $request->name()));
    }

    #[Authorize('discard', 'budget')]
    public function destroy(VersionRequest $request, Company $company, Budget $budget, ManageBudget $action): JsonResponse
    {
        $this->own($company, $budget);
        $action->discard(RequestActor::user($request, $company->id), $budget->id, $request->version());

        return response()->json(null, 204);
    }

    /** Saves a batch of cells of a draft against the version the editor loaded; answers the budget with its new version. */
    #[Authorize('update', 'budget')]
    public function saveLines(BudgetLinesRequest $request, Company $company, Budget $budget, SaveBudgetLines $action): JsonResponse
    {
        $this->own($company, $budget);
        $result = $action->handle(RequestActor::user($request, $company->id), $budget->id, $request->version(), $request->cells());

        return response()->json(['data' => $this->resource($result['budget'])->resolve(), 'meta' => ['written' => $result['written'], 'deleted' => $result['deleted']]]);
    }

    #[Authorize('approve', 'budget')]
    public function approve(VersionRequest $request, Company $company, Budget $budget, ApproveBudget $action): BudgetResource
    {
        $this->own($company, $budget);

        return $this->resource($action->handle(RequestActor::user($request, $company->id), $budget->id, $request->version()));
    }

    #[Authorize('archive', 'budget')]
    public function archive(VersionRequest $request, Company $company, Budget $budget, ManageBudget $action): BudgetResource
    {
        $this->own($company, $budget);

        return $this->resource($action->archive(RequestActor::user($request, $company->id), $budget->id, $request->version()));
    }

    /** An annual total split over the periods (remainder in the last); nothing is saved. `?total=` whole minor units. */
    #[Authorize('view', 'budget')]
    public function spread(BudgetQueryRequest $request, Company $company, Budget $budget, BudgetGrid $grid): FreeFormDataResource
    {
        $this->own($company, $budget);
        $total = $request->total() ?? throw ValidationException::withMessages(['total' => ['Give the annual total in whole minor units.']]);

        return new FreeFormDataResource($grid->spread($budget, $total));
    }

    /** Cells to put in the grid from another budget (`?source=budget&budget_id=`) or from a fiscal year's actuals (`?source=actuals&fiscal_year_id=`). Nothing is saved. */
    #[Authorize('view', 'budget')]
    public function suggestions(BudgetQueryRequest $request, Company $company, Budget $budget, BudgetGrid $grid): FreeFormDataResource
    {
        $this->own($company, $budget);
        $cells = match ($request->source()) {
            'budget' => $grid->fromBudget($budget, Budget::query()->where('company_id', $company->id)->findOrFail($request->budgetId() ?? throw ValidationException::withMessages(['budget_id' => ['Choose a budget of this company.']]))),
            'actuals' => $grid->fromActuals($budget, $request->fiscalYearId() ?? throw ValidationException::withMessages(['fiscal_year_id' => ['Choose a fiscal year of this company.']])),
            default => throw ValidationException::withMessages(['source' => ['Choose budget or actuals.']]),
        };

        return new FreeFormDataResource($cells);
    }

    /** The grid as CSV or XLSX. */
    #[Authorize('view', 'budget')]
    public function export(BudgetQueryRequest $request, Company $company, Budget $budget, BudgetExport $export, DetachedAudit $audit): Response
    {
        $this->own($company, $budget);
        $format = $request->exportFormat();
        $table = $export->table($budget, $company);
        $audit->record(RequestActor::user($request, $company->id), 'budget.exported', null, ['budget_id' => $budget->id, 'format' => $format]);

        return response()->streamDownload(function () use ($export, $table, $format): void {
            $export->write($table, $format, 'php://output');
        }, 'budget-'.Str::slug($company->name).'-v'.$budget->version.'-'.gmdate('Ymd').'.'.$format, ['Content-Type' => BudgetExport::FORMATS[$format], 'X-Content-Type-Options' => 'nosniff']);
    }

    private function resource(Budget $budget): BudgetResource
    {
        return new BudgetResource(Budget::query()->with('fiscalYear')->withCount('lines')->findOrFail($budget->id));
    }

    /** RLS separates tenants, not companies: another company's budget is a 404 here. */
    private function own(Company $company, Budget $budget): void
    {
        abort_unless($budget->company_id === $company->id, 404);
    }
}
