<?php

declare(strict_types=1);

namespace App\Actions\Fx;

use App\Actions\Fx\Inputs\ExchangeRateInput;
use App\Contracts\IdGenerator;
use App\Contracts\PermissionChecker;
use App\Domain\Shared\DomainRuleViolation;
use App\Models\Fx\ExchangeRate;
use App\Models\Fx\FxRevaluation;
use App\Support\Actor;
use App\Support\ActorType;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;
use Brick\Math\BigDecimal;

/**
 * A manual rate. One manual rate per pair and day: entering it again supersedes the value (a correction),
 * unless a revaluation run as of that day or later may already have used it (`fx_rate_in_use`); then the
 * correction is a new rate on a later day. Rates are never deleted. Tokens with `fx:write` may sync rates in;
 * the policy decided that, so the Action only asks people for the permission.
 */
final class RecordExchangeRate
{
    public function __construct(
        private readonly UnitOfWork $uow,
        private readonly PermissionChecker $permissions,
        private readonly IdGenerator $ids,
    ) {}

    public function handle(Actor $actor, ExchangeRateInput $in): ExchangeRate
    {
        if ($actor->type === ActorType::User && ! $this->permissions->allows($actor, 'fx.manage', $in->companyId)) {
            throw DomainRuleViolation::single('forbidden', 'This needs the fx.manage permission.');
        }
        if ($in->fromCurrency === $in->toCurrency) {
            throw DomainRuleViolation::single('fx_rate_invalid', 'A rate needs two different currencies.');
        }
        if (! BigDecimal::of($in->rate)->isPositive()) {
            throw DomainRuleViolation::single('fx_rate_invalid', 'A rate must be greater than zero.');
        }

        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $in) {
            $existing = ExchangeRate::query()->where('company_id', $in->companyId)
                ->where('from_currency', $in->fromCurrency)->where('to_currency', $in->toCurrency)
                ->where('rate_date', $in->rateDate)->where('source', 'manual')->lockForUpdate()->first();

            if ($existing === null) {
                $rate = new ExchangeRate;
                $rate->forceFill([
                    'id' => $this->ids->next(), 'tenant_id' => $actor->tenantId, 'company_id' => $in->companyId,
                    'from_currency' => $in->fromCurrency, 'to_currency' => $in->toCurrency, 'rate_date' => $in->rateDate,
                    'rate' => $in->rate, 'source' => 'manual', 'created_by' => $actor->id,
                ])->save();
                $audit->add('fx_rate.created', $rate, after: $rate);

                return $rate->refresh();
            }

            $used = FxRevaluation::query()->where('company_id', $in->companyId)->whereNotIn('status', ['void'])
                ->where('as_of', '>=', $in->rateDate)->exists();
            if ($used) {
                throw DomainRuleViolation::single('fx_rate_in_use', 'A revaluation as of this date or later may have used this rate; enter the correction on a later date.');
            }
            $before = $existing->attributesToArray();
            $existing->forceFill(['rate' => $in->rate, 'created_by' => $actor->id])->save();
            $audit->add('fx_rate.superseded', $existing, before: $before, after: $existing);

            return $existing->refresh();
        });
    }
}
