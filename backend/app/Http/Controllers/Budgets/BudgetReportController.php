<?php

declare(strict_types=1);

namespace App\Http\Controllers\Budgets;

use App\Http\Controllers\Controller;
use App\Http\Requests\Reports\ReportRequest;
use App\Http\Resources\FreeFormDataResource;
use App\Models\Budgets\Budget;
use App\Models\Organisation\Company;
use App\Queries\Budgets\BudgetVsActual;
use App\Queries\Reports\RunReport;
use App\Support\Reports\Report;
use Illuminate\Http\JsonResponse;
use Illuminate\Routing\Attributes\Controllers\Authorize;
use Illuminate\Support\Facades\Gate;

/** Budget vs actual and the dashboard note. Reading needs both `reports.view` and `budgets.view`. */
final class BudgetReportController extends Controller
{
    /** `period_id`, `basis` month|ytd, optional `budget_id` and `dimensions[<id>]=<value>`. Export goes through `reports/budget-vs-actual/export`. */
    #[Authorize('viewAny', Budget::class)]
    public function budgetVsActual(ReportRequest $request, Company $company, RunReport $report): JsonResponse
    {
        Gate::authorize('view', Report::class);

        return response()->json(['data' => $report('budget-vs-actual', $company, $request->validated())]);
    }

    /** This fiscal year to date against its approved budget; `data` is null when there is no approved budget, and the dashboard shows nothing. */
    #[Authorize('viewAny', Budget::class)]
    public function card(Company $company, BudgetVsActual $query): FreeFormDataResource
    {
        Gate::authorize('view', Report::class);

        return new FreeFormDataResource($query->card($company));
    }
}
