<?php

declare(strict_types=1);

namespace App\Http\Controllers\Ledger;

use App\Actions\Ledger\ManageAccount;
use App\Actions\Ledger\SetAccountDimensionRules;
use App\Http\Controllers\Controller;
use App\Http\Requests\Ledger\AccountDimensionRulesRequest;
use App\Http\Requests\Ledger\AccountRequest;
use App\Http\Requests\Ledger\ListAccountsRequest;
use App\Http\Requests\VersionRequest;
use App\Http\Resources\AccountResource;
use App\Http\Support\CursorPage;
use App\Http\Support\RequestActor;
use App\Models\Ledger\Account;
use App\Models\Organisation\Company;
use App\Queries\Ledger\ListAccounts;
use App\Queries\Ledger\ShowAccount;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Routing\Attributes\Controllers\Authorize;

/** The chart of accounts of a company. */
final class AccountController extends Controller
{
    #[Authorize('viewAny', Account::class)]
    public function index(ListAccountsRequest $request, Company $company, ListAccounts $accounts): AnonymousResourceCollection
    {
        $page = CursorPage::fetch($accounts($company->id, $request->type(), $request->active(), $request->search()), $request, 'code');

        return AccountResource::collection($page->items)->additional(['meta' => ['next_cursor' => $page->nextCursor, 'prev_cursor' => $page->prevCursor, 'limit' => $page->limit]]);
    }

    #[Authorize('view', 'account')]
    public function show(Company $company, Account $account, ShowAccount $show): AccountResource
    {
        return new AccountResource($show($account->id));
    }

    #[Authorize('create', Account::class)]
    public function store(AccountRequest $request, Company $company, ManageAccount $action, ShowAccount $show): JsonResponse
    {
        $account = $action->create(RequestActor::from($request, $company->id), $request->toInput());

        return (new AccountResource($show($account->id)))->response()->setStatusCode(201);
    }

    #[Authorize('update', 'account')]
    public function update(AccountRequest $request, Company $company, Account $account, ManageAccount $action, ShowAccount $show): AccountResource
    {
        $action->update(RequestActor::from($request, $company->id), $account->id, $request->version(), $request->toInput());

        return new AccountResource($show($account->id));
    }

    #[Authorize('deactivate', 'account')]
    public function deactivate(VersionRequest $request, Company $company, Account $account, ManageAccount $action, ShowAccount $show): AccountResource
    {
        $action->deactivate(RequestActor::from($request, $company->id), $account->id, $request->version());

        return new AccountResource($show($account->id));
    }

    /** Replaces the account's dimension rules with the given set. */
    #[Authorize('update', 'account')]
    public function setDimensionRules(AccountDimensionRulesRequest $request, Company $company, Account $account, SetAccountDimensionRules $action, ShowAccount $show): AccountResource
    {
        $action->handle(RequestActor::from($request, $company->id), $account->id, $request->dimensionRules());

        return new AccountResource($show($account->id));
    }
}
