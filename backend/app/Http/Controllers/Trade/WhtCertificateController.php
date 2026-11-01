<?php

declare(strict_types=1);

namespace App\Http\Controllers\Trade;

use App\Http\Controllers\Controller;
use App\Http\Requests\Trade\ListPaymentRunsRequest;
use App\Http\Resources\WhtCertificateResource;
use App\Http\Support\CursorPage;
use App\Models\Organisation\Company;
use App\Models\Trade\WhtCertificate;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Routing\Attributes\Controllers\Authorize;

/** WHT certificates: issued when a payment settles a bill that carries withholding; read only. Filters: `contact_id`, `status` (issued|void), `from|to`. */
final class WhtCertificateController extends Controller
{
    #[Authorize('viewAny', WhtCertificate::class)]
    public function index(ListPaymentRunsRequest $request, Company $company): AnonymousResourceCollection
    {
        $query = WhtCertificate::query()->where('company_id', $company->id);
        foreach (['contact_id', 'status'] as $column) {
            if ($request->filled($column)) {
                $query->where($column, (string) $request->query($column));
            }
        }
        if ($request->filled('from')) {
            $query->where('issued_on', '>=', (string) $request->query('from'));
        }
        if ($request->filled('to')) {
            $query->where('issued_on', '<=', (string) $request->query('to'));
        }
        $page = CursorPage::fetch($query, $request, 'issued_on', descending: true, kind: 'date');

        return WhtCertificateResource::collection($page->items)->additional(['meta' => ['next_cursor' => $page->nextCursor, 'prev_cursor' => $page->prevCursor, 'limit' => $page->limit]]);
    }

    #[Authorize('view', 'whtCertificate')]
    public function show(Company $company, WhtCertificate $whtCertificate): WhtCertificateResource
    {
        return new WhtCertificateResource($whtCertificate);
    }
}
