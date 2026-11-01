<?php

declare(strict_types=1);

namespace App\Actions\Ledger;

use App\Contracts\IdGenerator;
use App\Domain\Shared\DomainRuleViolation;
use App\Models\Ledger\Dimension;
use App\Models\Ledger\DimensionValue;
use App\Models\Organisation\Company;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;

/**
 * Analysis dimensions (up to eight per company, `dimensions.manage`) and their values. Codes are fixed once
 * created because posted lines refer to values by id and reports show the code; names, and whether
 * a dimension or value is in use, can change. Nothing is deleted.
 */
final class ManageDimension
{
    public const int MAX_DIMENSIONS = 8;

    public function __construct(
        private readonly UnitOfWork $uow,
        private readonly IdGenerator $ids,
        private readonly SetupGuard $guard,
    ) {}

    public function create(Actor $actor, string $companyId, string $code, string $name): Dimension
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $companyId, $code, $name) {
            $this->guard->require($actor, 'dimensions.manage', $companyId, tokens: true);
            // Concurrent creates queue on the company row, so positions never collide.
            $company = Company::query()->whereKey($companyId)->lock('FOR NO KEY UPDATE')->firstOrFail();
            if (Dimension::query()->where('company_id', $company->id)->where('code', $code)->exists()) {
                throw DomainRuleViolation::single('dimension_code_taken', "Dimension code {$code} is already used in this company.");
            }
            $position = (int) Dimension::query()->where('company_id', $company->id)->max('position') + 1;
            if ($position > self::MAX_DIMENSIONS) {
                throw DomainRuleViolation::single('dimension_limit_reached', 'A company can have at most '.self::MAX_DIMENSIONS.' dimensions.');
            }

            $dimension = new Dimension;
            $dimension->forceFill([
                'id' => $this->ids->next(), 'tenant_id' => $actor->tenantId, 'company_id' => $company->id,
                'code' => $code, 'name' => $name, 'position' => $position,
            ])->save();
            $dimension->refresh();
            $audit->add('dimension.created', $dimension, after: $dimension);

            return $dimension;
        });
    }

    public function rename(Actor $actor, string $dimensionId, int $version, string $name): Dimension
    {
        return $this->change($actor, $dimensionId, $version, 'dimension.updated', ['name' => $name]);
    }

    public function deactivate(Actor $actor, string $dimensionId, int $version): Dimension
    {
        return $this->change($actor, $dimensionId, $version, 'dimension.deactivated', ['is_active' => false]);
    }

    public function createValue(Actor $actor, string $dimensionId, string $code, string $name, ?string $parentId = null): DimensionValue
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $dimensionId, $code, $name, $parentId) {
            $dimension = Dimension::query()->findOrFail($dimensionId);
            $this->guard->require($actor, 'dimensions.manage', $dimension->company_id, tokens: true);
            $dimension = $locks->document($dimension);
            if (! $dimension->is_active) {
                throw DomainRuleViolation::single('dimension_inactive', 'Add values to an active dimension.');
            }
            if (DimensionValue::query()->where('dimension_id', $dimension->id)->where('code', $code)->exists()) {
                throw DomainRuleViolation::single('dimension_value_code_taken', "Value code {$code} is already used in this dimension.");
            }
            if ($parentId !== null && ! DimensionValue::query()->where('dimension_id', $dimension->id)->whereKey($parentId)->exists()) {
                throw DomainRuleViolation::single('dimension_value_parent_invalid', 'The parent must be a value of the same dimension.');
            }

            $value = new DimensionValue;
            $value->forceFill([
                'id' => $this->ids->next(), 'tenant_id' => $actor->tenantId, 'company_id' => $dimension->company_id,
                'dimension_id' => $dimension->id, 'code' => $code, 'name' => $name, 'parent_id' => $parentId,
            ])->save();
            $value->refresh();
            $audit->add('dimension_value.created', $value, after: $value);

            return $value;
        });
    }

    public function renameValue(Actor $actor, string $valueId, int $version, string $name): DimensionValue
    {
        return $this->changeValue($actor, $valueId, $version, 'dimension_value.updated', ['name' => $name]);
    }

    public function deactivateValue(Actor $actor, string $valueId, int $version): DimensionValue
    {
        return $this->changeValue($actor, $valueId, $version, 'dimension_value.deactivated', ['is_active' => false]);
    }

    /** @param array<string, mixed> $changes */
    private function change(Actor $actor, string $dimensionId, int $version, string $event, array $changes): Dimension
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $dimensionId, $version, $event, $changes) {
            $dimension = $locks->document(Dimension::query()->findOrFail($dimensionId), $version);
            $this->guard->require($actor, 'dimensions.manage', $dimension->company_id, tokens: true);

            $before = $dimension->attributesToArray();
            $dimension->forceFill([...$changes, 'lock_version' => $dimension->lock_version + 1])->save();
            $dimension->refresh();
            $audit->add($event, $dimension, before: $before, after: $dimension);

            return $dimension;
        });
    }

    /** @param array<string, mixed> $changes */
    private function changeValue(Actor $actor, string $valueId, int $version, string $event, array $changes): DimensionValue
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $valueId, $version, $event, $changes) {
            $value = $locks->document(DimensionValue::query()->findOrFail($valueId), $version);
            $this->guard->require($actor, 'dimensions.manage', $value->company_id, tokens: true);

            $before = $value->attributesToArray();
            $value->forceFill([...$changes, 'lock_version' => $value->lock_version + 1])->save();
            $value->refresh();
            $audit->add($event, $value, before: $before, after: $value);

            return $value;
        });
    }
}
