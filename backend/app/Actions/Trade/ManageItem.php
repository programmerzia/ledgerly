<?php

declare(strict_types=1);

namespace App\Actions\Trade;

use App\Actions\Ledger\SetupGuard;
use App\Actions\Trade\Inputs\ItemInput;
use App\Contracts\IdGenerator;
use App\Domain\Shared\DomainRuleViolation;
use App\Models\Ledger\Account;
use App\Models\Tax\TaxCode;
use App\Models\Trade\Item;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;

/**
 * Products and services (`items.manage`). An item only supplies defaults to new document lines (account, tax
 * code, price); posted documents keep their own copies. Items are deactivated, never deleted, and keep their code.
 */
final class ManageItem
{
    public function __construct(
        private readonly UnitOfWork $uow,
        private readonly IdGenerator $ids,
        private readonly SetupGuard $guard,
    ) {}

    public function create(Actor $actor, ItemInput $in): Item
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $in) {
            $this->guard->require($actor, 'items.manage', $in->companyId, tokens: true);
            $this->validate($in, null);

            $item = new Item;
            $item->forceFill(['id' => $this->ids->next(), 'tenant_id' => $actor->tenantId, 'company_id' => $in->companyId, ...$this->columns($in)])->save();
            $item->refresh();
            $audit->add('item.created', $item, after: $item);

            return $item;
        });
    }

    public function update(Actor $actor, string $itemId, int $version, ItemInput $in): Item
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $itemId, $version, $in) {
            $item = $locks->document(Item::query()->findOrFail($itemId), $version);
            $this->guard->require($actor, 'items.manage', $item->company_id, tokens: true);
            $this->validate($in, $item);

            $before = $item->attributesToArray();
            $item->forceFill([...$this->columns($in), 'lock_version' => $item->lock_version + 1])->save();
            $item->refresh();
            $audit->add('item.updated', $item, before: $before, after: $item);

            return $item;
        });
    }

    public function deactivate(Actor $actor, string $itemId, int $version): Item
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $itemId, $version) {
            $item = $locks->document(Item::query()->findOrFail($itemId), $version);
            $this->guard->require($actor, 'items.manage', $item->company_id, tokens: true);
            if (! $item->is_active) {
                throw DomainRuleViolation::single('item_already_inactive', 'The item is already inactive.');
            }

            $before = $item->attributesToArray();
            $item->forceFill(['is_active' => false, 'lock_version' => $item->lock_version + 1])->save();
            $item->refresh();
            $audit->add('item.deactivated', $item, before: $before, after: $item);

            return $item;
        });
    }

    /** @return array<string, mixed> */
    private function columns(ItemInput $in): array
    {
        return [
            'code' => $in->code, 'name' => $in->name, 'description' => $in->description, 'kind' => $in->kind,
            'sales_account_id' => $in->salesAccountId, 'purchase_account_id' => $in->purchaseAccountId,
            'sales_price' => $in->salesPrice, 'purchase_price' => $in->purchasePrice,
            'currency' => $in->currency, 'tax_code_id' => $in->taxCodeId,
        ];
    }

    private function validate(ItemInput $in, ?Item $current): void
    {
        if (Item::query()->where('company_id', $in->companyId)->where('code', $in->code)->when($current !== null, fn ($q) => $q->where('id', '!=', $current?->id))->exists()) {
            throw DomainRuleViolation::single('item_code_taken', "Item code {$in->code} is already used in this company.");
        }
        foreach ([$in->salesAccountId, $in->purchaseAccountId] as $accountId) {
            if ($accountId !== null && ! Account::query()->where('company_id', $in->companyId)->whereKey($accountId)->where('is_active', true)->where('is_postable', true)->exists()) {
                throw DomainRuleViolation::single('item_account_invalid', 'Default accounts must be active, postable accounts of this company.');
            }
        }
        if ($in->taxCodeId !== null && ! TaxCode::query()->where('company_id', $in->companyId)->whereKey($in->taxCodeId)->where('is_active', true)->where('kind', '!=', 'wht')->exists()) {
            throw DomainRuleViolation::single('item_tax_code_invalid', 'The default tax code must be an active, non-withholding tax code of this company.');
        }
    }
}
