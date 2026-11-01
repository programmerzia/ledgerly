<?php

declare(strict_types=1);

namespace App\Actions\Fiscal;

use App\Actions\Fiscal\Inputs\CreateFiscalYearInput;
use App\Contracts\IdGenerator;
use App\Contracts\PermissionChecker;
use App\Domain\Fiscal\FiscalCalendar;
use App\Domain\Fiscal\PeriodStatus;
use App\Domain\Shared\DomainRuleViolation;
use App\Models\Fiscal\FiscalPeriod;
use App\Models\Fiscal\FiscalYear;
use App\Models\Organisation\Company;
use App\Support\Actor;
use App\Support\ActorType;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;

/** Creates a fiscal year with 12 monthly periods and its adjustment period (D7). */
final class CreateFiscalYear
{
    public function __construct(
        private readonly UnitOfWork $uow,
        private readonly IdGenerator $ids,
        private readonly PermissionChecker $permissions,
    ) {}

    public function handle(Actor $actor, CreateFiscalYearInput $in): FiscalYear
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $in) {
            $company = Company::query()->findOrFail($in->companyId);
            if ($actor->type !== ActorType::System && ! $this->permissions->allows($actor, 'settings.manage', $company->id)) {
                throw DomainRuleViolation::single('forbidden', 'This needs the settings.manage permission.');
            }
            $planned = FiscalCalendar::monthly($in->startsOn);
            $endsOn = $planned[11]->endsOn;

            $overlaps = FiscalYear::query()
                ->where('company_id', $company->id)
                ->where('starts_on', '<=', $endsOn->format('Y-m-d'))
                ->where('ends_on', '>=', $in->startsOn->format('Y-m-d'))
                ->exists();
            if ($overlaps) {
                throw DomainRuleViolation::single('fiscal_year_overlap', 'The fiscal year overlaps an existing one.');
            }

            $year = new FiscalYear;
            $year->forceFill([
                'id' => $this->ids->next(),
                'tenant_id' => $actor->tenantId,
                'company_id' => $company->id,
                'name' => $in->name,
                'starts_on' => $in->startsOn,
                'ends_on' => $endsOn,
                'status' => 'open',
            ])->save();

            foreach ($planned as $p) {
                (new FiscalPeriod)->forceFill([
                    'id' => $this->ids->next(),
                    'tenant_id' => $actor->tenantId,
                    'company_id' => $company->id,
                    'fiscal_year_id' => $year->id,
                    'number' => $p->number,
                    'name' => $p->name,
                    'kind' => $p->kind->value,
                    'starts_on' => $p->startsOn,
                    'ends_on' => $p->endsOn,
                    'status' => PeriodStatus::Open,
                ])->save();
            }

            $audit->add('fiscal_year.created', $year, after: $year);

            return $year;
        });
    }
}
