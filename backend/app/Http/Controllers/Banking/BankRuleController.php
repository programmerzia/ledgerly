<?php

declare(strict_types=1);

namespace App\Http\Controllers\Banking;

use App\Actions\Banking\ManageBankRule;
use App\Http\Controllers\Controller;
use App\Http\Requests\Banking\BankRuleRequest;
use App\Http\Requests\Banking\RuleOrderRequest;
use App\Http\Resources\BankRuleResource;
use App\Http\Support\RequestActor;
use App\Models\Banking\BankRule;
use App\Models\Organisation\Company;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Routing\Attributes\Controllers\Authorize;

/** Bank rules: the ordered list that suggests how to code a line (`banking.rules.manage`). */
final class BankRuleController extends Controller
{
    /** In running order (priority, then id). */
    #[Authorize('viewAny', BankRule::class)]
    public function index(Company $company): AnonymousResourceCollection
    {
        return BankRuleResource::collection(BankRule::query()->where('company_id', $company->id)->orderBy('priority')->orderBy('id')->get());
    }

    #[Authorize('manageRules', BankRule::class)]
    public function store(BankRuleRequest $request, Company $company, ManageBankRule $action): JsonResponse
    {
        return (new BankRuleResource($action->create(RequestActor::user($request, $company->id), $request->toInput())->refresh()))->response()->setStatusCode(201);
    }

    #[Authorize('manageRules', 'bankRule')]
    public function update(BankRuleRequest $request, Company $company, BankRule $bankRule, ManageBankRule $action): BankRuleResource
    {
        return new BankRuleResource($action->update(RequestActor::user($request, $company->id), $bankRule->id, $request->version(), $request->toInput())->refresh());
    }

    #[Authorize('manageRules', 'bankRule')]
    public function destroy(Request $request, Company $company, BankRule $bankRule, ManageBankRule $action): Response
    {
        $action->delete(RequestActor::user($request, $company->id), $company->id, $bankRule->id);

        return response()->noContent();
    }

    /** Set the running order: every rule id exactly once; priorities become 1..n. */
    #[Authorize('manageRules', BankRule::class)]
    public function order(RuleOrderRequest $request, Company $company, ManageBankRule $action): AnonymousResourceCollection
    {
        return BankRuleResource::collection($action->reorder(RequestActor::user($request, $company->id), $company->id, $request->ids()));
    }
}
