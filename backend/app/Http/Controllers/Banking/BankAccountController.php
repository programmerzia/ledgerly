<?php

declare(strict_types=1);

namespace App\Http\Controllers\Banking;

use App\Actions\Banking\ImportBankStatement;
use App\Actions\Banking\ManageBankAccount;
use App\Http\Controllers\Controller;
use App\Http\Requests\Banking\BankAccountRequest;
use App\Http\Requests\Banking\ImportStatementRequest;
use App\Http\Requests\Banking\ListBankLinesRequest;
use App\Http\Resources\BankAccountResource;
use App\Http\Resources\BankStatementImportResource;
use App\Http\Resources\BankStatementLineResource;
use App\Http\Resources\BankStatementResource;
use App\Http\Support\CursorPage;
use App\Http\Support\RequestActor;
use App\Models\Banking\BankAccount;
use App\Models\Banking\BankStatement;
use App\Models\Banking\BankStatementLine;
use App\Models\Organisation\Company;
use App\Queries\Banking\BankQueries;
use App\Services\Banking\StatementImportResult;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Routing\Attributes\Controllers\Authorize;

/** Bank and cash accounts, their statement imports and statement lines (`banking.*`; tokens `banking:read`, and `banking:write` to import). */
final class BankAccountController extends Controller
{
    /** Every bank account with its book balance and unreconciled count (a short reference list, not paged). */
    #[Authorize('viewAny', BankAccount::class)]
    public function index(Company $company, BankQueries $queries): AnonymousResourceCollection
    {
        $figures = $queries->figures($company->id);

        return BankAccountResource::collection(BankAccount::query()->where('company_id', $company->id)->orderBy('name')->get()->each(
            fn (BankAccount $b) => $b->setAttribute('figures', $figures[$b->id] ?? ['book_balance' => 0, 'unreconciled_count' => 0]),
        ));
    }

    #[Authorize('view', 'bankAccount')]
    public function show(Company $company, BankAccount $bankAccount, BankQueries $queries): BankAccountResource
    {
        return BankAccountResource::withFigures($bankAccount, $queries->figures($company->id));
    }

    #[Authorize('manageAccounts', BankAccount::class)]
    public function store(BankAccountRequest $request, Company $company, ManageBankAccount $action): JsonResponse
    {
        $b = $action->create(RequestActor::user($request, $company->id), $request->toInput());

        return (new BankAccountResource($b->refresh()))->response()->setStatusCode(201);
    }

    #[Authorize('manageAccounts', 'bankAccount')]
    public function update(BankAccountRequest $request, Company $company, BankAccount $bankAccount, ManageBankAccount $action): BankAccountResource
    {
        return new BankAccountResource($action->update(RequestActor::user($request, $company->id), $bankAccount->id, $request->version(), $request->toInput())->refresh());
    }

    #[Authorize('view', 'bankAccount')]
    public function statements(Company $company, BankAccount $bankAccount): AnonymousResourceCollection
    {
        return BankStatementResource::collection(BankStatement::query()->where('bank_account_id', $bankAccount->id)->orderByDesc('period_to')->orderByDesc('id')->limit(200)->get());
    }

    /**
     * Import a CSV, OFX or CAMT.053 file, synchronously (files over 2 MB or 5,000 lines are refused). Lines already imported are skipped:
     * the same file twice adds nothing. Errors name the line (`violations[].line_no`).
     */
    #[Authorize('import', 'bankAccount')]
    public function import(ImportStatementRequest $request, Company $company, BankAccount $bankAccount, ImportBankStatement $action): JsonResponse
    {
        $r = $action->handle(RequestActor::from($request, $company->id), $request->toInput($bankAccount->id));

        $result = new StatementImportResult($r['statement'], $r['inserted'], $r['skipped'], $r['already_imported'], $r['warnings']);

        if ($r['inserted'] > 0) {
            return (new BankStatementImportResource($result))->response()->setStatusCode(201);
        }

        return (new BankStatementImportResource($result))->response();
    }

    #[Authorize('view', 'bankAccount')]
    public function lines(ListBankLinesRequest $request, Company $company, BankAccount $bankAccount, BankQueries $queries): AnonymousResourceCollection
    {
        $page = CursorPage::fetch($queries->lines($company->id, $bankAccount->id, $request->filters()), $request, 'txn_date', descending: true, kind: 'date');

        return BankStatementLineResource::collection($page->items)->additional(['meta' => ['next_cursor' => $page->nextCursor, 'prev_cursor' => $page->prevCursor, 'limit' => $page->limit]]);
    }

    #[Authorize('view', 'statementLine')]
    public function line(Company $company, BankStatementLine $statementLine, BankQueries $queries): BankStatementLineResource
    {
        return new BankStatementLineResource($queries->lineWithState($company->id, $statementLine->id) ?? $statementLine);
    }
}
