<?php

declare(strict_types=1);

namespace App\Actions\Tax;

use App\Actions\Ledger\SetupGuard;
use App\Actions\Tax\Inputs\TaxCodeInput;
use App\Actions\Tax\Inputs\TaxRateInput;
use App\Contracts\IdGenerator;
use App\Domain\Shared\DomainRuleViolation;
use App\Domain\Tax\TaxRatePeriod;
use App\Models\Ledger\Account;
use App\Models\Tax\TaxCode;
use App\Models\Tax\TaxRate;
use App\Models\Trade\Contact;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;
use DateTimeImmutable;

/**
 * Tax codes and their dated rates (`tax.manage`; people only, API clients may read tax set-up but never change it).
 * Codes are deactivated, never deleted, and a code's text stays fixed. Rates are history: a new rate is added from a
 * date; the open-ended rate before it is closed the day before, and no two rates of a code ever overlap.
 */
final class ManageTaxCode
{
    public function __construct(
        private readonly UnitOfWork $uow,
        private readonly IdGenerator $ids,
        private readonly SetupGuard $guard,
    ) {}

    public function create(Actor $actor, TaxCodeInput $in, ?TaxRateInput $rate = null): TaxCode
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $in, $rate) {
            $this->guard->require($actor, 'tax.manage', $in->companyId);
            $this->assertAccounts($in);
            if (TaxCode::query()->where('company_id', $in->companyId)->where('code', $in->code)->exists()) {
                throw DomainRuleViolation::single('tax_code_taken', "Tax code {$in->code} is already used in this company.");
            }

            $code = new TaxCode;
            $code->forceFill([
                'id' => $this->ids->next(), 'tenant_id' => $actor->tenantId, 'company_id' => $in->companyId,
                'code' => $in->code, ...$this->columns($in),
            ])->save();
            if ($rate !== null) {
                $this->insertRate($actor, $code, $rate);
            }
            $code->refresh();
            $audit->add('tax_code.created', $code, after: $code, context: $rate === null ? [] : ['rate' => $rate->rate, 'effective_from' => $rate->effectiveFrom->format('Y-m-d')]);

            return $code;
        });
    }

    public function update(Actor $actor, string $taxCodeId, int $version, TaxCodeInput $in): TaxCode
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $taxCodeId, $version, $in) {
            $code = $locks->document(TaxCode::query()->findOrFail($taxCodeId), $version);
            $this->guard->require($actor, 'tax.manage', $code->company_id);
            $this->assertAccounts($in);
            if ($code->kind === 'wht' && $in->kind !== 'wht' && Contact::query()->where('wht_code_id', $code->id)->exists()) {
                throw DomainRuleViolation::single('tax_code_in_use', 'Contacts withhold with this code, so it stays a withholding tax code.');
            }

            $before = $code->attributesToArray();
            $code->forceFill([...$this->columns($in), 'lock_version' => $code->lock_version + 1])->save();
            $code->refresh();
            $audit->add('tax_code.updated', $code, before: $before, after: $code);

            return $code;
        });
    }

    public function addRate(Actor $actor, string $taxCodeId, int $version, TaxRateInput $in): TaxCode
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $taxCodeId, $version, $in) {
            $code = $locks->document(TaxCode::query()->findOrFail($taxCodeId), $version);
            $this->guard->require($actor, 'tax.manage', $code->company_id);
            $closed = $this->insertRate($actor, $code, $in);
            $code->forceFill(['lock_version' => $code->lock_version + 1])->save();
            $code->refresh();
            $audit->add('tax_code.rate_added', $code, after: $code, context: [
                'rate' => $in->rate, 'effective_from' => $in->effectiveFrom->format('Y-m-d'),
                'effective_to' => $in->effectiveTo?->format('Y-m-d'), 'closed_previous_rate_on' => $closed?->format('Y-m-d'),
            ]);

            return $code;
        });
    }

    public function deactivate(Actor $actor, string $taxCodeId, int $version): TaxCode
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $taxCodeId, $version) {
            $code = $locks->document(TaxCode::query()->findOrFail($taxCodeId), $version);
            $this->guard->require($actor, 'tax.manage', $code->company_id);
            if (! $code->is_active) {
                throw DomainRuleViolation::single('tax_code_already_inactive', 'The tax code is already inactive.');
            }

            $before = $code->attributesToArray();
            $code->forceFill(['is_active' => false, 'lock_version' => $code->lock_version + 1])->save();
            $code->refresh();
            $audit->add('tax_code.deactivated', $code, before: $before, after: $code);

            return $code;
        });
    }

    /** @return array<string, mixed> */
    private function columns(TaxCodeInput $in): array
    {
        return [
            'name' => $in->name, 'kind' => $in->kind, 'collect_account_id' => $in->collectAccountId,
            'pay_account_id' => $in->payAccountId, 'is_recoverable' => $in->isRecoverable,
        ];
    }

    private function assertAccounts(TaxCodeInput $in): void
    {
        foreach ([$in->collectAccountId, $in->payAccountId] as $accountId) {
            if ($accountId !== null && ! Account::query()->where('company_id', $in->companyId)->whereKey($accountId)->where('is_active', true)->exists()) {
                throw DomainRuleViolation::single('tax_account_invalid', 'Tax accounts must be active accounts of this company.');
            }
        }
    }

    /** Inserts the rate; returns the date the previous open-ended rate was closed on, when it was. */
    private function insertRate(Actor $actor, TaxCode $code, TaxRateInput $in): ?DateTimeImmutable
    {
        $new = new TaxRatePeriod($in->rate, $in->effectiveFrom, $in->effectiveTo);
        $overlapping = TaxRate::query()->where('tax_code_id', $code->id)->orderBy('effective_from')->get()
            ->filter(fn (TaxRate $r): bool => (new TaxRatePeriod($r->rate, $r->effective_from->toDateTimeImmutable(), $r->effective_to?->toDateTimeImmutable()))->overlaps($new))
            ->values();

        $closedOn = null;
        if ($overlapping->isNotEmpty()) {
            // The one overlap that is not a conflict: an open-ended rate that began earlier, superseded by an open-ended one.
            $previous = $overlapping->firstOrFail();
            $supersedes = $overlapping->count() === 1 && $previous->effective_to === null
                && $in->effectiveTo === null && $previous->effective_from->format('Y-m-d') < $in->effectiveFrom->format('Y-m-d');
            if (! $supersedes) {
                throw DomainRuleViolation::single('tax_rate_overlap', 'The dates overlap an existing rate of this tax code.');
            }
            $closedOn = $in->effectiveFrom->modify('-1 day');
            $previous->forceFill(['effective_to' => $closedOn->format('Y-m-d')])->save();
        }

        $rate = new TaxRate;
        $rate->forceFill([
            'id' => $this->ids->next(), 'tenant_id' => $actor->tenantId, 'company_id' => $code->company_id, 'tax_code_id' => $code->id,
            'rate' => $in->rate, 'effective_from' => $in->effectiveFrom->format('Y-m-d'), 'effective_to' => $in->effectiveTo?->format('Y-m-d'),
        ])->save();

        return $closedOn;
    }
}
