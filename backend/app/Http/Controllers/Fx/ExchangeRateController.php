<?php

declare(strict_types=1);

namespace App\Http\Controllers\Fx;

use App\Actions\Fx\FetchExchangeRates;
use App\Actions\Fx\RecordExchangeRate;
use App\Domain\Shared\DomainRuleViolation;
use App\Http\Controllers\Controller;
use App\Http\Requests\Fx\ExchangeRateRequest;
use App\Http\Requests\Fx\ListExchangeRatesRequest;
use App\Http\Resources\ExchangeRateResource;
use App\Http\Support\CursorPage;
use App\Http\Support\RequestActor;
use App\Models\Fx\ExchangeRate;
use App\Models\Organisation\Company;
use App\Queries\Fx\ListExchangeRates;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Routing\Attributes\Controllers\Authorize;

/** The company's rate table: read, enter a manual rate, pull the provider's. Rates are never deleted. */
final class ExchangeRateController extends Controller
{
    #[Authorize('viewAny', ExchangeRate::class)]
    public function index(ListExchangeRatesRequest $request, Company $company, ListExchangeRates $rates): AnonymousResourceCollection
    {
        $query = $rates($company->id, $request->filter('from'), $request->filter('to'), $request->filter('source'), $request->filter('date_from'), $request->filter('date_to'));
        $page = CursorPage::fetch($query, $request, 'rate_date', descending: true, kind: 'date');

        return ExchangeRateResource::collection($page->items)->additional(['meta' => ['next_cursor' => $page->nextCursor, 'prev_cursor' => $page->prevCursor, 'limit' => $page->limit]]);
    }

    /** One manual rate per pair and day; entering it again corrects it unless a revaluation may have used it. */
    #[Authorize('create', ExchangeRate::class)]
    public function store(ExchangeRateRequest $request, Company $company, RecordExchangeRate $action): JsonResponse
    {
        $rate = $action->handle(RequestActor::from($request, $company->id), $request->toInput());

        return (new ExchangeRateResource($rate))->response()->setStatusCode(201);
    }

    /** Pulls today's provider rates for the currencies this company uses. A provider outage is a 502 and changes nothing. */
    #[Authorize('fetch', ExchangeRate::class)]
    public function fetch(Request $request, Company $company, FetchExchangeRates $action): JsonResponse
    {
        $result = $action->handle(RequestActor::user($request, $company->id), $company->id);
        if ($result->error !== null) {
            throw DomainRuleViolation::single('fx_provider_unavailable', 'The rate provider is unavailable; existing rates are unchanged.');
        }

        return response()->json(['data' => [
            'provider' => $result->provider, 'rate_date' => $result->rateDate, 'inserted' => $result->inserted, 'skipped_currencies' => $result->skipped,
        ]]);
    }
}
