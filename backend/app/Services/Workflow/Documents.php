<?php

declare(strict_types=1);

namespace App\Services\Workflow;

use App\Actions\FixedAssets\PostAssetTransaction;
use App\Actions\FixedAssets\PostDepreciationRun;
use App\Actions\Ledger\Inputs\PostJournalInput;
use App\Actions\Ledger\PostJournal;
use App\Actions\Procurement\ApplyOrderRevision;
use App\Actions\Procurement\FinalizePurchaseOrder;
use App\Actions\Procurement\FinalizeRequisition;
use App\Actions\Trade\PostInvoice;
use App\Actions\Trade\PostPaymentRun;
use App\Actions\Trade\PostSettlement;
use App\Actions\Transactions\PostProvisionRun;
use App\Actions\Transactions\PostWriteOff;
use App\Actions\Transfers\PostFundTransfer;
use App\Actions\Workflow\Inputs\DocumentRef;
use App\Contracts\PermissionChecker;
use App\Contracts\Postable;
use App\Domain\FixedAssets\AssetPermissions;
use App\Domain\Ledger\JournalType;
use App\Domain\Shared\DomainRuleViolation;
use App\Domain\Shared\Violation;
use App\Domain\Trade\InvoiceKind;
use App\Domain\Workflow\DocumentStatus;
use App\Models\FixedAssets\AssetTransaction;
use App\Models\FixedAssets\DepreciationRun;
use App\Models\Ledger\Journal;
use App\Models\Procurement\PurchaseOrder;
use App\Models\Procurement\PurchaseOrderRevision;
use App\Models\Procurement\PurchaseRequisition;
use App\Models\Trade\Invoice;
use App\Models\Trade\PaymentRun;
use App\Models\Trade\Settlement;
use App\Models\Transactions\ProvisionRun;
use App\Models\Transactions\WriteOff;
use App\Models\Transfers\FundTransfer;
use App\Queries\Ledger\PreviewJournalPosting;
use App\Queries\Procurement\DocumentReadiness;
use App\Queries\Trade\PreviewInvoicePosting;
use App\Queries\Trade\PreviewSettlementPosting;
use App\Queries\Transactions\PreviewProvisionPosting;
use App\Queries\Transactions\PreviewWriteOffPosting;
use App\Queries\Transfers\PreviewFundTransferPosting;
use App\Services\FixedAssets\AssetTransactionReadiness;
use App\Services\FixedAssets\DepreciationRunReadiness;
use App\Services\Ledger\PostingEngine;
use App\Services\Procurement\BillMatchGate;
use App\Services\Trade\CreditLimitGate;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use DateTimeImmutable;
use Illuminate\Contracts\Container\Container;
use Illuminate\Database\Eloquent\Model;

/**
 * The per-type knowledge the workflow Actions need (13 §10): how to find a document, lock it in
 * the global order (its period first, then the row), check it would post, and post it. Each Postable type
 * registers here. `invoice` covers invoices and credit notes, `bill` bills and debit notes (permissions
 * `invoices.*` and `bills.*`).
 */
final class Documents
{
    public const array TYPES = ['journal', 'invoice', 'bill', 'settlement', 'payment_run', 'purchase_requisition', 'purchase_order', 'purchase_order_revision', 'fund_transfer', 'write_off', 'provision_run', 'depreciation_run', 'asset_transaction'];

    /** The types a workflow can be set up for. A revision has none of its own: it goes through its order's (workflowType). */
    public const array WORKFLOW_TYPES = ['journal', 'invoice', 'bill', 'settlement', 'payment_run', 'purchase_requisition', 'purchase_order', 'fund_transfer', 'write_off', 'provision_run', 'depreciation_run', 'asset_transaction'];

    public function __construct(
        private readonly Container $container,
        private readonly PostingEngine $engine,
        private readonly PermissionChecker $permissions,
    ) {}

    /** Unlocked read. */
    public function find(DocumentRef $ref): Postable&Model
    {
        $doc = match ($ref->type) {
            'journal' => Journal::query()->with('lines')->find($ref->id),
            'invoice' => Invoice::query()->with('lines')->whereIn('kind', InvoiceKind::values(...InvoiceKind::sales()))->find($ref->id),
            'bill' => Invoice::query()->with('lines')->whereIn('kind', InvoiceKind::values(...InvoiceKind::purchases()))->find($ref->id),
            'settlement' => Settlement::query()->with('allocations')->find($ref->id),
            'payment_run' => PaymentRun::query()->with('items')->find($ref->id),
            'purchase_requisition' => PurchaseRequisition::query()->with('lines')->find($ref->id),
            'purchase_order' => PurchaseOrder::query()->with('lines')->find($ref->id),
            'purchase_order_revision' => PurchaseOrderRevision::query()->find($ref->id),
            'provision_run' => ProvisionRun::query()->find($ref->id),
            'write_off' => WriteOff::query()->find($ref->id),
            'fund_transfer' => FundTransfer::query()->find($ref->id),
            'depreciation_run' => DepreciationRun::query()->with('lines')->find($ref->id),
            'asset_transaction' => AssetTransaction::query()->with('lines')->find($ref->id),
            default => throw DomainRuleViolation::single('document_type_unknown', "Unknown document type {$ref->type}."),
        };
        if ($doc === null) {
            throw DomainRuleViolation::single('not_found', 'The document does not exist.');
        }

        return $doc;
    }

    /** Level 1 (the document's period) then level 2 (the row, FOR UPDATE, lock_version checked). */
    public function lock(LockSet $locks, Postable&Model $doc, ?int $expectedVersion): Postable&Model
    {
        if ($doc instanceof Journal) {
            $this->engine->lockPeriod($locks, $doc->company_id, $doc->journal_type, $doc->journal_date, $doc->fiscal_period_id);
        }
        if ($doc instanceof Invoice) {
            $this->engine->lockPeriod($locks, $doc->company_id, $doc->kind->journalType(), DateTimeImmutable::createFromInterface($doc->issue_date), null);
            // A note locks together with the document it refers to, by id, so its capacity check sees a stable original.
            if ($doc->related_invoice_id !== null) {
                $pair = [$doc->id, $doc->related_invoice_id];
                sort($pair, SORT_STRING);
                $locked = [];
                foreach ($pair as $id) {
                    $locked[$id] = $locks->document($id === $doc->id ? $doc : Invoice::query()->whereKey($id)->firstOrFail(), $id === $doc->id ? $expectedVersion : null);
                }

                return $locked[$doc->id]->load('lines');
            }
        }
        if ($doc instanceof Settlement) {
            $this->engine->lockPeriod($locks, $doc->company_id, $doc->isCashIn() ? JournalType::Receipt : JournalType::Payment, DateTimeImmutable::createFromInterface($doc->settlement_date), null);
            // The settlement and any settlement whose credit it refunds, by id (13 §8 level 2).
            $ids = [$doc->id, ...array_values(array_filter($doc->allocations->pluck('source_settlement_id')->all()))];
            sort($ids, SORT_STRING);
            $locked = [];
            foreach ($ids as $id) {
                $locked[$id] = $locks->document($id === $doc->id ? $doc : Settlement::query()->whereKey($id)->firstOrFail(), $id === $doc->id ? $expectedVersion : null);
            }

            return $locked[$doc->id]->load('allocations');
        }
        if ($doc instanceof PaymentRun) {
            $this->engine->lockPeriod($locks, $doc->company_id, JournalType::Payment, DateTimeImmutable::createFromInterface($doc->run_date), null);

            return $locks->document($doc, $expectedVersion)->load('items');
        }
        if ($doc instanceof FundTransfer) {
            $this->engine->lockPeriod($locks, $doc->company_id, JournalType::Bank, DateTimeImmutable::createFromInterface($doc->send_date), null);

            return $locks->document($doc, $expectedVersion);
        }
        if ($doc instanceof ProvisionRun) {
            $this->engine->lockPeriod($locks, $doc->company_id, JournalType::Manual, DateTimeImmutable::createFromInterface($doc->as_of), null);

            return $locks->document($doc, $expectedVersion);
        }
        if ($doc instanceof WriteOff) {
            $this->engine->lockPeriod($locks, $doc->company_id, JournalType::Sales, DateTimeImmutable::createFromInterface($doc->write_off_date), null);

            return $locks->document($doc, $expectedVersion);
        }
        if ($doc instanceof PurchaseOrderRevision) {
            return $locks->document($doc, $expectedVersion);
        }
        if ($doc instanceof AssetTransaction) {
            $this->engine->lockPeriod($locks, $doc->company_id, JournalType::Asset, DateTimeImmutable::createFromInterface($doc->tx_date), null);

            return $locks->document($doc, $expectedVersion)->load('lines');
        }
        if ($doc instanceof DepreciationRun) {
            // The whole period is held for the run (13 §8), then the run.
            $locks->periodsById($doc->company_id, [$doc->fiscal_period_id], forUpdate: true);

            return $locks->document($doc, $expectedVersion)->load('lines');
        }

        return $locks->document($doc, $expectedVersion)->load('lines');
    }

    /**
     * What would stop this document from posting, without locks or side effects (submit fails early on it).
     *
     * @return list<Violation>
     */
    public function violations(Actor $actor, Postable&Model $doc): array
    {
        return match (true) {
            $doc instanceof Journal => $this->container->make(PreviewJournalPosting::class)->of($actor, $doc->id)->violations,
            $doc instanceof Invoice => $this->container->make(PreviewInvoicePosting::class)->of($actor, $doc->id)->violations,
            $doc instanceof Settlement => $this->container->make(PreviewSettlementPosting::class)->of($actor, $doc->id)->violations,
            $doc instanceof PaymentRun => $this->container->make(PreviewSettlementPosting::class)->ofRun($actor, $doc->id)->violations,
            $doc instanceof ProvisionRun => $this->container->make(PreviewProvisionPosting::class)->of($actor, $doc->id)->violations,
            $doc instanceof WriteOff => $this->container->make(PreviewWriteOffPosting::class)->of($actor, $doc->id)->violations,
            $doc instanceof FundTransfer => $this->container->make(PreviewFundTransferPosting::class)->of($actor, $doc->id)->violations,
            $doc instanceof PurchaseRequisition => $this->container->make(DocumentReadiness::class)->ofRequisition($doc),
            $doc instanceof PurchaseOrder => $this->container->make(DocumentReadiness::class)->ofOrder($doc),
            $doc instanceof PurchaseOrderRevision => $this->container->make(DocumentReadiness::class)->ofRevision($doc),
            $doc instanceof DepreciationRun => $this->container->make(DepreciationRunReadiness::class)->of($doc),
            $doc instanceof AssetTransaction => $this->container->make(AssetTransactionReadiness::class)->of($doc),
            default => throw new \LogicException("No preview for {$doc->documentType()}."),
        };
    }

    /** Posts inside the caller's UnitOfWork; the poster re-locks (no-ops) and revalidates. */
    public function post(Actor $actor, Postable&Model $doc): Postable&Model
    {
        return match (true) {
            $doc instanceof Journal => $this->container->make(PostJournal::class)->handle($actor, new PostJournalInput($doc->documentId())),
            $doc instanceof Invoice => $this->container->make(PostInvoice::class)->handle($actor, $doc->documentId()),
            $doc instanceof Settlement => $this->container->make(PostSettlement::class)->handle($actor, $doc->documentId()),
            $doc instanceof PaymentRun => $this->container->make(PostPaymentRun::class)->handle($actor, $doc->documentId()),
            $doc instanceof ProvisionRun => $this->container->make(PostProvisionRun::class)->handle($actor, $doc->documentId()),
            $doc instanceof WriteOff => $this->container->make(PostWriteOff::class)->handle($actor, $doc->documentId()),
            $doc instanceof FundTransfer => $this->container->make(PostFundTransfer::class)->handle($actor, $doc->documentId()),
            $doc instanceof PurchaseRequisition => $this->container->make(FinalizeRequisition::class)->handle($actor, $doc->documentId()),
            $doc instanceof PurchaseOrder => $this->container->make(FinalizePurchaseOrder::class)->handle($actor, $doc->documentId()),
            $doc instanceof PurchaseOrderRevision => $this->container->make(ApplyOrderRevision::class)->handle($actor, $doc->documentId()),
            $doc instanceof DepreciationRun => $this->container->make(PostDepreciationRun::class)->handle($actor, $doc->documentId()),
            $doc instanceof AssetTransaction => $this->container->make(PostAssetTransaction::class)->handle($actor, $doc->documentId()),
            default => throw new \LogicException("No poster for {$doc->documentType()}."),
        };
    }

    /**
     * The three-way match of a purchase bill, under the bill's lock, after the posting checks (13 §10). Every other document
     * passes straight through.
     */
    public function beforeSubmit(Actor $actor, LockSet $locks, AuditBuffer $audit, Outbox $outbox, Postable&Model $doc, ?string $matchOverrideReason, ?string $creditLimitReason = null): void
    {
        if ($doc instanceof Invoice && $doc->kind === InvoiceKind::SalesInvoice) {
            $this->container->make(CreditLimitGate::class)->enforce($actor, $locks, $audit, $outbox, $doc, $creditLimitReason);
        }
        if ($doc instanceof Invoice && $doc->kind === InvoiceKind::PurchaseBill) {
            $this->container->make(BillMatchGate::class)->enforce($actor, $locks, $audit, $outbox, $doc, $matchOverrideReason);
        }
    }

    /** Which document type's workflow applies. */
    public function workflowType(string $type): string
    {
        return $type === 'purchase_order_revision' ? 'purchase_order' : $type;
    }

    /** What asking for the PIN says when no workflow applies and submit finishes the document. */
    public function signingPrompt(Postable&Model $doc): string
    {
        return in_array($doc->documentType(), ['purchase_requisition', 'purchase_order', 'purchase_order_revision'], true)
            ? 'Approving needs your signing PIN.'
            : 'Posting needs your signing PIN.';
    }

    /**
     * The permission an action needs on this document. Journals, invoices and bills follow `<type>s.<action>`. Settlements
     * and payment runs have no `.submit` of their own: submitting and returning follow creating (`receipts.create` for a
     * receipt, `payments.create` for the other settlements and runs) and approving, returning and voiding follow
     * `payments.approve` (13 §7 has no receipts.approve).
     */
    public function permission(Postable&Model $doc, string $action): string
    {
        if ($doc instanceof Settlement) {
            return in_array($action, ['approve', 'return', 'void'], true) ? 'payments.approve' : $doc->module().'.create';
        }
        if ($doc instanceof PaymentRun) {
            return in_array($action, ['approve', 'return', 'void'], true) ? 'payments.approve' : 'payments.create';
        }
        if ($doc instanceof ProvisionRun) {
            return 'provisions.'.(in_array($action, ['return', 'void'], true) ? 'approve' : $action);
        }
        if ($doc instanceof WriteOff) {
            return 'write_offs.'.(in_array($action, ['return', 'void'], true) ? 'approve' : $action);
        }
        if ($doc instanceof FundTransfer) {
            return 'transfers.'.(in_array($action, ['return', 'void'], true) ? 'approve' : $action);
        }

        if ($doc instanceof AssetTransaction) {
            return match ($action) {
                'submit' => AssetPermissions::FOR_KIND[$doc->kind],
                'approve', 'return', 'void' => 'fixed_assets.approve',
                default => 'fixed_assets.'.$action,
            };
        }
        if ($doc instanceof DepreciationRun) {
            return match ($action) {
                'submit' => 'fixed_assets.run_depreciation',
                'approve', 'return', 'void' => 'fixed_assets.approve',
                default => 'fixed_assets.'.$action,
            };
        }

        if ($doc instanceof PurchaseOrderRevision) {
            return 'purchase_orders.'.(in_array($action, ['return', 'void'], true) ? 'approve' : $action);
        }

        // Returning and voiding are an approver's act (13 §10): they follow `<type>s.approve`.
        return "{$doc->documentType()}s.".(in_array($action, ['return', 'void'], true) ? 'approve' : $action);
    }

    /**
     * Who may void (13 §10), on top of "the creator or an approver" that VoidDocument already requires. A person
     * needs `<type>s.void`, or may void as an approver; the Sales Assistant's `invoices.void_own` covers the
     * person's own drafts only (not documents already waiting for approval).
     */
    public function authorizeVoid(Actor $actor, Postable&Model $doc): void
    {
        if (! $doc instanceof Invoice || $actor->isApiClient()) {
            return; // journals keep VoidDocument's rule; a token's ability was checked by the route policy
        }
        $module = $doc->kind->documentType().'s';
        $company = $doc->company_id;
        $own = $actor->id !== null && $doc->created_by === $actor->id;

        $ok = $this->permissions->allows($actor, "{$module}.void", $company)
            || $this->permissions->allows($actor, "{$module}.approve", $company)
            || ($own && $doc->status === DocumentStatus::Draft && $this->permissions->allows($actor, "{$module}.void_own", $company));
        if (! $ok) {
            throw DomainRuleViolation::single('forbidden', "You cannot void this {$doc->kind->label()}.");
        }
    }
}
