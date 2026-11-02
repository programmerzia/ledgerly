<?php

declare(strict_types=1);

namespace App\Http\Controllers\Banking;

use App\Actions\Banking\ManageBankReconciliation;
use App\Http\Controllers\Controller;
use App\Http\Requests\Banking\ReconciliationRequest;
use App\Http\Resources\BankReconciliationResource;
use App\Http\Support\RequestActor;
use App\Models\Banking\BankAccount;
use App\Models\Banking\BankReconciliation;
use App\Models\Banking\BankStatement;
use App\Models\Organisation\Company;
use App\Services\Banking\ReconciliationCalculator;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Routing\Attributes\Controllers\Authorize;

/** Reconciliations: start one for a statement, watch the live difference, finish it at zero, reopen it with a reason (`banking.reconcile`). */
final class BankReconciliationController extends Controller
{
    #[Authorize('view', 'bankAccount')]
    public function index(Company $company, BankAccount $bankAccount): AnonymousResourceCollection
    {
        return BankReconciliationResource::collection(BankReconciliation::query()->where('bank_account_id', $bankAccount->id)->orderByDesc('as_of')->orderByDesc('id')->limit(200)->get());
    }

    #[Authorize('view', 'bankReconciliation')]
    public function show(Company $company, BankReconciliation $bankReconciliation, ReconciliationCalculator $calculator): BankReconciliationResource
    {
        return $this->present($bankReconciliation, $calculator);
    }

    #[Authorize('reconcile', BankReconciliation::class)]
    public function store(ReconciliationRequest $request, Company $company, ManageBankReconciliation $action, ReconciliationCalculator $calculator): JsonResponse
    {
        $r = $action->start(RequestActor::user($request, $company->id), $company->id, $request->statementId());

        return $this->present($r->refresh(), $calculator)->response()->setStatusCode(201);
    }

    #[Authorize('reconcile', 'bankReconciliation')]
    public function finish(ReconciliationRequest $request, Company $company, BankReconciliation $bankReconciliation, ManageBankReconciliation $action, ReconciliationCalculator $calculator): BankReconciliationResource
    {
        return $this->present($action->finish(RequestActor::user($request, $company->id), $company->id, $bankReconciliation->id, $request->version())->refresh(), $calculator);
    }

    #[Authorize('reconcile', 'bankReconciliation')]
    public function reopen(ReconciliationRequest $request, Company $company, BankReconciliation $bankReconciliation, ManageBankReconciliation $action, ReconciliationCalculator $calculator): BankReconciliationResource
    {
        return $this->present($action->reopen(RequestActor::user($request, $company->id), $company->id, $bankReconciliation->id, $request->reason(), $request->version())->refresh(), $calculator);
    }

    private function present(BankReconciliation $r, ReconciliationCalculator $calculator): BankReconciliationResource
    {
        $live = $r->status === 'in_progress'
            ? $calculator->compute(BankAccount::query()->findOrFail($r->bank_account_id), BankStatement::query()->findOrFail($r->statement_id))
            : null;

        return BankReconciliationResource::withLive($r, $live);
    }
}
