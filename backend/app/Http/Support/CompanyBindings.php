<?php

declare(strict_types=1);

namespace App\Http\Support;

use App\Domain\Shared\DomainRuleViolation;
use App\Domain\Trade\InvoiceKind;
use App\Models\BaseModel;
use App\Models\Files\Attachment;
use App\Models\Fiscal\FiscalPeriod;
use App\Models\Fiscal\FiscalYear;
use App\Models\Fiscal\PeriodReopenRequest;
use App\Models\Ledger\Account;
use App\Models\Ledger\Dimension;
use App\Models\Ledger\DimensionValue;
use App\Models\Ledger\Journal;
use App\Models\Tax\TaxCode;
use App\Models\Tax\TaxGroup;
use App\Models\Trade\Contact;
use App\Models\Trade\CreditApplication;
use App\Models\Trade\Invoice;
use App\Models\Trade\Item;
use App\Models\Trade\PaymentRun;
use App\Models\Trade\Settlement;
use App\Models\Trade\WhtCertificate;
use App\Models\Workflow\ApprovalWorkflow;
use App\Support\Tenancy\CompanyContext;
use Illuminate\Routing\Route as RoutedRequest;
use Illuminate\Support\Facades\Route;

/**
 * Route-model binding for resources under /companies/{company} (13 §6). RLS isolates tenants, not
 * companies, so every bound id is looked up inside the request's company: an id that belongs to
 * another company of the same tenant is a 404, exactly like an id that does not exist. Fails closed
 * when no company is resolved. Runs after `ResolveCompany` (middleware priority, bootstrap/app.php).
 */
final class CompanyBindings
{
    /** @var array<string, class-string<BaseModel>> route parameter → model */
    public const array MODELS = [
        'journal' => Journal::class,
        'account' => Account::class,
        'dimension' => Dimension::class,
        'dimensionValue' => DimensionValue::class,
        'fiscalYear' => FiscalYear::class,
        'fiscalPeriod' => FiscalPeriod::class,
        'reopenRequest' => PeriodReopenRequest::class,
        'workflow' => ApprovalWorkflow::class,
        'contact' => Contact::class,
        'taxCode' => TaxCode::class,
        'taxGroup' => TaxGroup::class,
        'item' => Item::class,
        'settlement' => Settlement::class,
        'paymentRun' => PaymentRun::class,
        'whtCertificate' => WhtCertificate::class,
        'creditApplication' => CreditApplication::class,
        'attachment' => Attachment::class,
        // /invoices/{invoice} holds invoices and credit notes, /bills/{bill} bills and debit notes: the other family is a 404.
        'invoice' => Invoice::class,
        'bill' => Invoice::class,
    ];

    public static function register(): void
    {
        foreach (self::MODELS as $parameter => $model) {
            Route::bind($parameter, function (string $id, RoutedRequest $route) use ($parameter, $model): BaseModel {
                $companyId = app(CompanyContext::class)->id();
                $query = $model::query()->whereKey($id);
                if ($companyId !== null) {
                    $query->where('company_id', $companyId);
                } else {
                    $query->whereRaw('false');
                }
                // A value is addressed through its dimension: /dimensions/{dimension}/values/{dimensionValue}.
                if ($parameter === 'dimensionValue' && $route->hasParameter('dimension')) {
                    $dimension = $route->parameter('dimension');
                    $query->where('dimension_id', $dimension instanceof Dimension ? $dimension->id : (is_string($dimension) ? $dimension : ''));
                }

                if ($parameter === 'invoice' || $parameter === 'bill') {
                    $query->whereIn('kind', InvoiceKind::values(...($parameter === 'invoice' ? InvoiceKind::sales() : InvoiceKind::purchases())));
                }

                return $query->first() ?? throw DomainRuleViolation::single('not_found', 'The resource does not exist.');
            });
        }
    }
}
