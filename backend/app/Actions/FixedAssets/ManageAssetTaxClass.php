<?php

declare(strict_types=1);

namespace App\Actions\FixedAssets;

use App\Actions\Ledger\SetupGuard;
use App\Contracts\IdGenerator;
use App\Domain\Shared\DomainRuleViolation;
use App\Models\FixedAssets\AssetTaxClass;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;
use Illuminate\Database\UniqueConstraintViolationException;

/**
 * Tax depreciation classes (`fixed_assets.manage`): a code, an annual rate on cost and an optional first-year rate, in basis points.
 * They are data for the tax schedule, which never posts; changing one changes the report, not the books.
 */
final class ManageAssetTaxClass
{
    public function __construct(private readonly UnitOfWork $uow, private readonly IdGenerator $ids, private readonly SetupGuard $guard) {}

    public function create(Actor $actor, string $companyId, string $code, string $name, int $annualRateBp, ?int $firstYearRateBp, bool $isActive = true): AssetTaxClass
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $companyId, $code, $name, $annualRateBp, $firstYearRateBp, $isActive) {
            $this->guard->require($actor, 'fixed_assets.manage', $companyId);
            $class = new AssetTaxClass;
            try {
                $class->forceFill([
                    'id' => $this->ids->next(), 'tenant_id' => $actor->tenantId, 'company_id' => $companyId, 'code' => $code, 'name' => $name,
                    'annual_rate_bp' => $annualRateBp, 'first_year_rate_bp' => $firstYearRateBp, 'source' => 'company', 'is_active' => $isActive,
                ])->save();
            } catch (UniqueConstraintViolationException) {
                throw DomainRuleViolation::single('tax_class_code_taken', 'A tax class with this code already exists.');
            }
            $class->refresh();
            $audit->add('asset_tax_class.created', $class, after: $class);

            return $class;
        });
    }

    public function update(Actor $actor, string $classId, int $version, string $name, int $annualRateBp, ?int $firstYearRateBp, bool $isActive): AssetTaxClass
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $classId, $version, $name, $annualRateBp, $firstYearRateBp, $isActive) {
            $class = $locks->document(AssetTaxClass::query()->findOrFail($classId), $version);
            $this->guard->require($actor, 'fixed_assets.manage', $class->company_id);
            $before = $class->attributesToArray();
            $class->forceFill([
                'name' => $name, 'annual_rate_bp' => $annualRateBp, 'first_year_rate_bp' => $firstYearRateBp, 'is_active' => $isActive,
                'lock_version' => $class->lock_version + 1,
            ])->save();
            $class->refresh();
            $audit->add('asset_tax_class.updated', $class, before: $before, after: $class);

            return $class;
        });
    }
}
