<?php

declare(strict_types=1);

namespace App\Http\Controllers\Fx;

use App\Actions\Fx\RunFxRevaluation;
use App\Http\Controllers\Controller;
use App\Http\Requests\Fx\FxRevaluationRequest;
use App\Http\Requests\Fx\ListFxRevaluationsRequest;
use App\Http\Resources\FxRevaluationPreviewResource;
use App\Http\Resources\FxRevaluationResource;
use App\Http\Support\CursorPage;
use App\Http\Support\RequestActor;
use App\Models\Fx\FxRevaluation;
use App\Models\Organisation\Company;
use App\Queries\Fx\ListFxRevaluations;
use App\Queries\Fx\PreviewFxRevaluation;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Routing\Attributes\Controllers\Authorize;

/** Month-end unrealised FX revaluation runs: history, a side-effect-free preview, and the run itself (people only). */
final class FxRevaluationController extends Controller
{
    #[Authorize('viewAny', FxRevaluation::class)]
    public function index(ListFxRevaluationsRequest $request, Company $company, ListFxRevaluations $runs): AnonymousResourceCollection
    {
        $page = CursorPage::fetch($runs($company->id, $request->periodId()), $request, 'as_of', descending: true, kind: 'date');

        return FxRevaluationResource::collection($page->items)->additional(['meta' => ['next_cursor' => $page->nextCursor, 'prev_cursor' => $page->prevCursor, 'limit' => $page->limit]]);
    }

    /** What running now would post, and what would stop it. Writes nothing and takes no lock. */
    #[Authorize('viewAny', FxRevaluation::class)]
    public function preview(FxRevaluationRequest $request, Company $company, PreviewFxRevaluation $preview): FxRevaluationPreviewResource
    {
        return new FxRevaluationPreviewResource($preview($company->id, $request->periodId(), $request->asOf()));
    }

    /** Needs `fx.manage` and a signing grant. One run per period; the reversal next period follows automatically. */
    #[Authorize('run', FxRevaluation::class)]
    public function run(FxRevaluationRequest $request, Company $company, RunFxRevaluation $action): JsonResponse
    {
        $run = $action->handle(RequestActor::user($request, $company->id), $request->toInput());

        return (new FxRevaluationResource($run))->response()->setStatusCode(201);
    }
}
