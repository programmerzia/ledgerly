<?php

declare(strict_types=1);

namespace App\Actions\Tax;

use App\Actions\Ledger\SetupGuard;
use App\Actions\Tax\Inputs\TaxGroupInput;
use App\Contracts\IdGenerator;
use App\Domain\Shared\DomainRuleViolation;
use App\Models\Tax\TaxCode;
use App\Models\Tax\TaxGroup;
use App\Models\Tax\TaxGroupItem;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;

/**
 * Tax groups: several tax codes charged together, in sequence (`tax.manage`; people only). An item marked
 * `compound` is charged on the net plus the taxes before it. Withholding codes belong on payments, not on
 * document lines, so they cannot join a group. Groups are deactivated, never deleted.
 */
final class ManageTaxGroup
{
    public function __construct(
        private readonly UnitOfWork $uow,
        private readonly IdGenerator $ids,
        private readonly SetupGuard $guard,
    ) {}

    public function create(Actor $actor, TaxGroupInput $in): TaxGroup
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $in) {
            $this->guard->require($actor, 'tax.manage', $in->companyId);
            $this->assertItems($in);
            if (TaxGroup::query()->where('company_id', $in->companyId)->where('code', $in->code)->exists()) {
                throw DomainRuleViolation::single('tax_group_code_taken', "Tax group code {$in->code} is already used in this company.");
            }

            $group = new TaxGroup;
            $group->forceFill(['id' => $this->ids->next(), 'tenant_id' => $actor->tenantId, 'company_id' => $in->companyId, 'code' => $in->code, 'name' => $in->name])->save();
            $this->writeItems($actor, $group, $in);
            $group->refresh()->load('items');
            $audit->add('tax_group.created', $group, after: $this->snapshot($group));

            return $group;
        });
    }

    public function update(Actor $actor, string $taxGroupId, int $version, TaxGroupInput $in): TaxGroup
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $taxGroupId, $version, $in) {
            $group = $locks->document(TaxGroup::query()->findOrFail($taxGroupId), $version);
            $this->guard->require($actor, 'tax.manage', $group->company_id);
            $this->assertItems($in);

            $group->load('items');
            $before = $this->snapshot($group);
            TaxGroupItem::query()->where('tax_group_id', $group->id)->delete();
            $group->forceFill(['name' => $in->name, 'lock_version' => $group->lock_version + 1])->save();
            $this->writeItems($actor, $group, $in);
            $group->refresh()->load('items');
            $audit->add('tax_group.updated', $group, before: $before, after: $this->snapshot($group));

            return $group;
        });
    }

    public function deactivate(Actor $actor, string $taxGroupId, int $version): TaxGroup
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $taxGroupId, $version) {
            $group = $locks->document(TaxGroup::query()->findOrFail($taxGroupId), $version);
            $this->guard->require($actor, 'tax.manage', $group->company_id);
            if (! $group->is_active) {
                throw DomainRuleViolation::single('tax_group_already_inactive', 'The tax group is already inactive.');
            }

            $group->load('items');
            $before = $this->snapshot($group);
            $group->forceFill(['is_active' => false, 'lock_version' => $group->lock_version + 1])->save();
            $group->refresh()->load('items');
            $audit->add('tax_group.deactivated', $group, before: $before, after: $this->snapshot($group));

            return $group;
        });
    }

    private function assertItems(TaxGroupInput $in): void
    {
        if ($in->items === []) {
            throw DomainRuleViolation::single('tax_group_empty', 'A tax group needs at least one tax code.');
        }
        $ids = array_column($in->items, 'tax_code_id');
        if (count(array_unique($ids)) !== count($ids)) {
            throw DomainRuleViolation::single('tax_group_duplicate_code', 'A tax code can appear in a group only once.');
        }
        if ($in->items[0]['compound']) {
            throw DomainRuleViolation::single('tax_group_first_compound', 'The first tax of a group has nothing to compound on.');
        }
        $codes = TaxCode::query()->where('company_id', $in->companyId)->whereIn('id', $ids)->where('is_active', true)->where('kind', '!=', 'wht')->count();
        if ($codes !== count($ids)) {
            throw DomainRuleViolation::single('tax_group_code_invalid', 'Group members must be active, non-withholding tax codes of this company.');
        }
    }

    private function writeItems(Actor $actor, TaxGroup $group, TaxGroupInput $in): void
    {
        foreach ($in->items as $k => $item) {
            (new TaxGroupItem)->forceFill([
                'id' => $this->ids->next(), 'tenant_id' => $actor->tenantId, 'company_id' => $group->company_id, 'tax_group_id' => $group->id,
                'tax_code_id' => $item['tax_code_id'], 'sequence' => $k + 1, 'compound' => $item['compound'],
            ])->save();
        }
    }

    /** @return array<string, mixed> */
    private function snapshot(TaxGroup $group): array
    {
        return [
            ...$group->attributesToArray(),
            'items' => $group->items->map(fn (TaxGroupItem $i): array => ['tax_code_id' => $i->tax_code_id, 'sequence' => $i->sequence, 'compound' => $i->compound])->all(),
        ];
    }
}
