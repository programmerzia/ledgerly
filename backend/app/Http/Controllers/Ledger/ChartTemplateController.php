<?php

declare(strict_types=1);

namespace App\Http\Controllers\Ledger;

use App\Actions\Ledger\ApplyChartTemplate;
use App\Actions\Ledger\Inputs\ApplyChartTemplateInput;
use App\Http\Controllers\Controller;
use App\Http\Requests\Ledger\ApplyChartTemplateRequest;
use App\Http\Resources\ChartTemplateResource;
use App\Http\Support\RequestActor;
use App\Models\Ledger\Account;
use App\Models\Organisation\Company;
use App\Queries\Ledger\ListChartTemplates;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Routing\Attributes\Controllers\Authorize;

/** Onboarding step 2 (02 §3): pick a chart template and copy it into a company with no accounts. */
final class ChartTemplateController extends Controller
{
    #[Authorize('applyTemplate', Account::class)]
    public function index(ListChartTemplates $templates): AnonymousResourceCollection
    {
        return ChartTemplateResource::collection(collect($templates()));
    }

    #[Authorize('applyTemplate', Account::class)]
    public function apply(ApplyChartTemplateRequest $request, Company $company, ApplyChartTemplate $action): JsonResponse
    {
        $created = $action->handle(RequestActor::from($request, $company->id), new ApplyChartTemplateInput($company->id, $request->templateCode()));

        return response()->json(['data' => ['template_code' => $request->templateCode(), 'accounts_created' => $created]], 201);
    }
}
