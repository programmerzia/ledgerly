<?php

declare(strict_types=1);

namespace App\Http\Support;

use App\Http\Resources\AccountResource;
use App\Http\Resources\ApiClientResource;
use App\Http\Resources\ApprovalWorkflowResource;
use App\Http\Resources\AssetCategoryResource;
use App\Http\Resources\BankAccountResource;
use App\Http\Resources\BankMatchResource;
use App\Http\Resources\BankReconciliationResource;
use App\Http\Resources\BankRuleResource;
use App\Http\Resources\BankTransactionResource;
use App\Http\Resources\CompanyResource;
use App\Http\Resources\ContactResource;
use App\Http\Resources\DepreciationRunResource;
use App\Http\Resources\DimensionResource;
use App\Http\Resources\DimensionValueResource;
use App\Http\Resources\FiscalPeriodResource;
use App\Http\Resources\FiscalYearResource;
use App\Http\Resources\FixedAssetResource;
use App\Http\Resources\InvitationResource;
use App\Http\Resources\InvoiceResource;
use App\Http\Resources\ItemResource;
use App\Http\Resources\JournalResource;
use App\Http\Resources\PaymentRunResource;
use App\Http\Resources\RecurringScheduleResource;
use App\Http\Resources\ReopenRequestResource;
use App\Http\Resources\SettlementResource;
use App\Http\Resources\TaxCodeResource;
use App\Http\Resources\TaxGroupResource;
use App\Models\Banking\BankAccount;
use App\Models\Banking\BankMatch;
use App\Models\Banking\BankReconciliation;
use App\Models\Banking\BankRule;
use App\Models\Banking\BankTransaction;
use App\Models\Fiscal\FiscalPeriod;
use App\Models\Fiscal\FiscalYear;
use App\Models\Fiscal\PeriodReopenRequest;
use App\Models\FixedAssets\AssetCategory;
use App\Models\FixedAssets\DepreciationRun;
use App\Models\FixedAssets\FixedAsset;
use App\Models\Ledger\Account;
use App\Models\Ledger\Dimension;
use App\Models\Ledger\DimensionValue;
use App\Models\Ledger\Journal;
use App\Models\Organisation\ApiClient;
use App\Models\Organisation\Company;
use App\Models\Organisation\Invitation;
use App\Models\Recurring\RecurringInvoice;
use App\Models\Recurring\RecurringJournal;
use App\Models\Tax\TaxCode;
use App\Models\Tax\TaxGroup;
use App\Models\Trade\Contact;
use App\Models\Trade\Invoice;
use App\Models\Trade\Item;
use App\Models\Trade\PaymentRun;
use App\Models\Trade\Settlement;
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
        'api_clients' => [ApiClient::class, ApiClientResource::class, ['tokens']],
        'asset_categories' => [AssetCategory::class, AssetCategoryResource::class, []],
        'depreciation_runs' => [DepreciationRun::class, DepreciationRunResource::class, ['lines.asset']],
        'fixed_assets' => [FixedAsset::class, FixedAssetResource::class, ['category:id,name']],
        'journals' => [Journal::class, JournalResource::class, ['lines']],
        'accounts' => [Account::class, AccountResource::class, ['dimensionRules']],
        'dimensions' => [Dimension::class, DimensionResource::class, ['values']],
        'dimension_values' => [DimensionValue::class, DimensionValueResource::class, []],
        'fiscal_years' => [FiscalYear::class, FiscalYearResource::class, ['periods.pendingReopenRequest']],
        'fiscal_periods' => [FiscalPeriod::class, FiscalPeriodResource::class, ['pendingReopenRequest']],
        'period_reopen_requests' => [PeriodReopenRequest::class, ReopenRequestResource::class, []],
        'approval_workflows' => [ApprovalWorkflow::class, ApprovalWorkflowResource::class, []],
        'contacts' => [Contact::class, ContactResource::class, []],
        'tax_codes' => [TaxCode::class, TaxCodeResource::class, ['rates']],
        'tax_groups' => [TaxGroup::class, TaxGroupResource::class, ['items']],
        'invoices' => [Invoice::class, InvoiceResource::class, ['lines']],
        'items' => [Item::class, ItemResource::class, []],
        'settlements' => [Settlement::class, SettlementResource::class, ['allocations']],
        'payment_runs' => [PaymentRun::class, PaymentRunResource::class, ['items']],
        'bank_accounts' => [BankAccount::class, BankAccountResource::class, []],
        'bank_rules' => [BankRule::class, BankRuleResource::class, []],
        'bank_matches' => [BankMatch::class, BankMatchResource::class, ['items']],
        'bank_transactions' => [BankTransaction::class, BankTransactionResource::class, ['journal']],
        'bank_reconciliations' => [BankReconciliation::class, BankReconciliationResource::class, []],
        'recurring_invoices' => [RecurringInvoice::class, RecurringScheduleResource::class, []],
        'recurring_journals' => [RecurringJournal::class, RecurringScheduleResource::class, []],
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
