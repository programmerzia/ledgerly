<?php

declare(strict_types=1);

namespace App\Http\Support;

use App\Http\Resources\AccountResource;
use App\Http\Resources\ApprovalWorkflowResource;
use App\Http\Resources\CompanyResource;
use App\Http\Resources\DimensionResource;
use App\Http\Resources\DimensionValueResource;
use App\Http\Resources\FiscalPeriodResource;
use App\Http\Resources\FiscalYearResource;
use App\Http\Resources\InvitationResource;
use App\Http\Resources\JournalResource;
use App\Http\Resources\ReopenRequestResource;
use App\Models\Fiscal\FiscalPeriod;
use App\Models\Fiscal\FiscalYear;
use App\Models\Fiscal\PeriodReopenRequest;
use App\Models\Ledger\Account;
use App\Models\Ledger\Dimension;
use App\Models\Ledger\DimensionValue;
use App\Models\Ledger\Journal;
use App\Models\Organisation\Company;
use App\Models\Organisation\Invitation;
use App\Models\Workflow\ApprovalWorkflow;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The current representation of a subject, for an idempotent retry whose change committed but
 * whose response was never stored (13 §11). Each API resource registers its table here, with the
 * relations its single-record response carries.
 */
final class SubjectRepresenter
{
    /** @var array<string, array{class-string<Model>, class-string<JsonResource>, list<string>}> table → model, resource, relations */
    private const array RESOURCES = [
        'companies' => [Company::class, CompanyResource::class, []],
        'invitations' => [Invitation::class, InvitationResource::class, []],
        'journals' => [Journal::class, JournalResource::class, ['lines']],
        'accounts' => [Account::class, AccountResource::class, ['dimensionRules']],
        'dimensions' => [Dimension::class, DimensionResource::class, ['values']],
        'dimension_values' => [DimensionValue::class, DimensionValueResource::class, []],
        'fiscal_years' => [FiscalYear::class, FiscalYearResource::class, ['periods.pendingReopenRequest']],
        'fiscal_periods' => [FiscalPeriod::class, FiscalPeriodResource::class, ['pendingReopenRequest']],
        'period_reopen_requests' => [PeriodReopenRequest::class, ReopenRequestResource::class, []],
        'approval_workflows' => [ApprovalWorkflow::class, ApprovalWorkflowResource::class, []],
    ];

    public function represent(?string $subjectType, ?string $subjectId): JsonResponse
    {
        if ($subjectType === null || $subjectId === null) {
            return new JsonResponse(['data' => null]);
        }
        [$model, $resource, $with] = self::RESOURCES[$subjectType] ?? [null, null, []];
        $found = $model === null ? null : $model::query()->with($with)->find($subjectId);
        if ($found === null || $resource === null) {
            return new JsonResponse(['data' => ['type' => $subjectType, 'id' => $subjectId]]);
        }

        return (new $resource($found))->response()->setStatusCode(200);
    }
}
