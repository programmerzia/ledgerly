<?php

declare(strict_types=1);

namespace App\Http\Controllers\Banking;

use App\Actions\Banking\ApplyBankRule;
use App\Actions\Banking\CreateBankTransaction;
use App\Actions\Banking\MatchStatementLine;
use App\Actions\Banking\UnmatchStatementLine;
use App\Domain\Banking\BankRuleMatcher;
use App\Http\Controllers\Controller;
use App\Http\Requests\Banking\BankTransactionRequest;
use App\Http\Requests\Banking\MatchRequest;
use App\Http\Resources\BankMatchResource;
use App\Http\Resources\BankRuleResource;
use App\Http\Resources\BankTransactionResource;
use App\Http\Support\CursorPage;
use App\Http\Support\RequestActor;
use App\Models\Banking\BankAccount;
use App\Models\Banking\BankMatch;
use App\Models\Banking\BankRule;
use App\Models\Banking\BankStatementLine;
use App\Models\Banking\BankTransaction;
use App\Models\Organisation\Company;
use App\Queries\Banking\BankQueries;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Routing\Attributes\Controllers\Authorize;

/** Matching statement lines to the books, and coding unmatched lines as bank transactions. */
final class BankMatchingController extends Controller
{
    /**
     * Posted, unmatched book lines with exactly the line's amount within `window_days` (default 7, at most 60), each with why it fits
     * (`explanation`), plus the first bank rule that matches the line.
     */
    #[Authorize('view', 'statementLine')]
    public function suggestions(Request $request, Company $company, BankStatementLine $statementLine, BankQueries $queries): JsonResponse
    {
        $window = min(60, max(0, (int) $request->query('window_days', '7')));
        $bank = BankAccount::query()->findOrFail($statementLine->bank_account_id);
        $rules = BankRule::query()->where('company_id', $company->id)->where('is_active', true)
            ->where(fn ($q) => $q->whereNull('bank_account_id')->orWhere('bank_account_id', $bank->id))->get();
        $ruleId = $statementLine->status === 'unmatched' ? BankRuleMatcher::firstMatch(
            ['amount' => $statementLine->amount, 'description' => $statementLine->description, 'counterparty' => $statementLine->counterparty, 'reference' => $statementLine->reference],
            array_values($rules->map(fn (BankRule $r): array => ['id' => $r->id, 'priority' => $r->priority, 'is_active' => true, 'conditions' => $r->conditions])->all()),
        ) : null;
        $rule = $ruleId === null ? null : $rules->firstWhere('id', $ruleId);

        return response()->json(['data' => [
            'matches' => $statementLine->status === 'unmatched' ? $queries->suggestions($statementLine, $bank->account_id, $window) : [],
            'rule' => $rule === null ? null : (new BankRuleResource($rule))->resolve($request),
        ]]);
    }

    /** Match statement lines with book lines or settlements. The two sides must add up to exactly the same amount. */
    #[Authorize('reconcile', BankMatch::class)]
    public function match(MatchRequest $request, Company $company, MatchStatementLine $action): JsonResponse
    {
        $m = $action->handle(RequestActor::user($request, $company->id), $request->toInput());
        $m->setAttribute('currency', BankAccount::query()->whereKey($m->bank_account_id)->value('currency'));

        return (new BankMatchResource($m->load('items')))->response()->setStatusCode(201);
    }

    /** Remove a match, until a finished reconciliation covers it. */
    #[Authorize('reconcile', 'bankMatch')]
    public function unmatch(Request $request, Company $company, BankMatch $bankMatch, UnmatchStatementLine $action): Response
    {
        $action->handle(RequestActor::user($request, $company->id), $company->id, $bankMatch->id);

        return response()->noContent();
    }

    /** Code the line as spend, receive or transfer money. Posts at once below the journal threshold, otherwise waits for an approver. */
    #[Authorize('codeLines', 'statementLine')]
    public function transaction(BankTransactionRequest $request, Company $company, BankStatementLine $statementLine, CreateBankTransaction $action): JsonResponse
    {
        $t = $action->handle(RequestActor::user($request, $company->id), $request->toInput($statementLine->id));

        return (new BankTransactionResource($t->load('journal')))->response()->setStatusCode(201);
    }

    /** Apply a bank rule (the first matching one, or `rule_id`) to the line: the person's confirmation of the rule's suggestion. */
    #[Authorize('codeLines', 'statementLine')]
    public function applyRule(Request $request, Company $company, BankStatementLine $statementLine, ApplyBankRule $action): JsonResponse
    {
        $ruleId = $request->input('rule_id');
        $t = $action->handle(RequestActor::user($request, $company->id), $company->id, $statementLine->id, is_string($ruleId) && $ruleId !== '' ? $ruleId : null);

        return (new BankTransactionResource($t->load('journal')))->response()->setStatusCode(201);
    }

    #[Authorize('viewAny', BankTransaction::class)]
    public function transactions(Request $request, Company $company): AnonymousResourceCollection
    {
        $page = CursorPage::fetch(BankTransaction::query()->where('company_id', $company->id)->with('journal'), $request, 'id', descending: true, kind: 'uuid');

        return BankTransactionResource::collection($page->items)->additional(['meta' => ['next_cursor' => $page->nextCursor, 'prev_cursor' => $page->prevCursor, 'limit' => $page->limit]]);
    }

    #[Authorize('view', 'bankTransaction')]
    public function showTransaction(Company $company, BankTransaction $bankTransaction): BankTransactionResource
    {
        return new BankTransactionResource($bankTransaction->load('journal'));
    }
}
