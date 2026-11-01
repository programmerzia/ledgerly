<?php

declare(strict_types=1);

namespace App\Http\Controllers\Fiscal;

use App\Actions\Fiscal\CreateFiscalYear;
use App\Actions\Fiscal\LockFiscalYear;
use App\Actions\Fiscal\YearEndClose;
use App\Http\Controllers\Controller;
use App\Http\Requests\Fiscal\CreateFiscalYearRequest;
use App\Http\Resources\FiscalYearResource;
use App\Http\Support\RequestActor;
use App\Models\Fiscal\FiscalYear;
use App\Models\Organisation\Company;
use App\Queries\Fiscal\ListFiscalYears;
use App\Queries\Fiscal\ShowFiscalYear;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Routing\Attributes\Controllers\Authorize;

/** Fiscal years with their periods; year-end close and lock. */
final class FiscalYearController extends Controller
{
    #[Authorize('viewAny', FiscalYear::class)]
    public function index(Request $request, Company $company, ListFiscalYears $years): AnonymousResourceCollection
    {
        return FiscalYearResource::collection($years($company->id));
    }

    #[Authorize('create', FiscalYear::class)]
    public function store(CreateFiscalYearRequest $request, Company $company, CreateFiscalYear $action, ShowFiscalYear $show): JsonResponse
    {
        $year = $action->handle(RequestActor::from($request, $company->id), $request->toInput());

        return (new FiscalYearResource($show($year->id)))->response()->setStatusCode(201);
    }

    /** Closes income and expenses into retained earnings (journal type `closing`); needs a signing grant. */
    #[Authorize('yearEnd', 'fiscalYear')]
    public function yearEnd(Request $request, Company $company, FiscalYear $fiscalYear, YearEndClose $action, ShowFiscalYear $show): FiscalYearResource
    {
        $closing = $action->handle(RequestActor::from($request, $company->id), $fiscalYear->id);

        return (new FiscalYearResource($show($fiscalYear->id)))->additional(['meta' => ['closing_journal_id' => $closing?->id]]);
    }

    #[Authorize('lock', 'fiscalYear')]
    public function lock(Request $request, Company $company, FiscalYear $fiscalYear, LockFiscalYear $action, ShowFiscalYear $show): FiscalYearResource
    {
        $action->handle(RequestActor::from($request, $company->id), $fiscalYear->id);

        return new FiscalYearResource($show($fiscalYear->id));
    }
}
