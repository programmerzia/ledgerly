<?php

declare(strict_types=1);

namespace App\Actions\Banking;

use App\Actions\Banking\Inputs\BankRuleInput;
use App\Actions\Ledger\SetupGuard;
use App\Contracts\IdGenerator;
use App\Domain\Banking\BankTransactionPosting;
use App\Domain\Shared\DomainRuleViolation;
use App\Models\Banking\BankAccount;
use App\Models\Banking\BankRule;
use App\Models\Ledger\Account;
use App\Models\Tax\TaxCode;
use App\Models\Trade\Contact;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;
use App\Support\UnitOfWork\VersionConflict;

/** Bank rules (14 E1): an ordered list, first match wins, a rule only suggests. `banking.rules.manage`, people only. */
final class ManageBankRule
{
    private const string PERMISSION = 'banking.rules.manage';

    public function __construct(private readonly UnitOfWork $uow, private readonly SetupGuard $guard, private readonly IdGenerator $ids) {}

    public function create(Actor $actor, BankRuleInput $in): BankRule
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $in) {
            $this->guard->require($actor, self::PERMISSION, $in->companyId);
            $this->check($in);
            $priority = $in->priority ?? ((int) BankRule::query()->where('company_id', $in->companyId)->max('priority') + 1);
            $r = new BankRule;
            $r->forceFill([
                'id' => $this->ids->next(), 'tenant_id' => $actor->tenantId, 'company_id' => $in->companyId, 'bank_account_id' => $in->bankAccountId,
                'name' => $in->name, 'priority' => $priority, 'conditions' => $in->conditions, 'action' => $in->action, 'is_active' => $in->isActive,
                'times_applied' => 0, 'lock_version' => 0,
            ])->save();
            $audit->add('bank_rule.created', $r, after: $r);

            return $r;
        });
    }

    public function update(Actor $actor, string $id, int $lockVersion, BankRuleInput $in): BankRule
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $id, $lockVersion, $in) {
            $this->guard->require($actor, self::PERMISSION, $in->companyId);
            $this->check($in);
            $seen = BankRule::query()->where('company_id', $in->companyId)->find($id) ?? throw DomainRuleViolation::single('not_found', 'The rule does not exist.');
            $r = $this->lock($seen, $lockVersion);
            $before = $r->attributesToArray();
            $r->forceFill([
                'bank_account_id' => $in->bankAccountId, 'name' => $in->name, 'conditions' => $in->conditions, 'action' => $in->action,
                'is_active' => $in->isActive, 'priority' => $in->priority ?? $r->priority, 'lock_version' => $r->lock_version + 1,
            ])->save();
            $audit->add('bank_rule.updated', $r, before: $before, after: $r);

            return $r;
        });
    }

    public function delete(Actor $actor, string $companyId, string $id): void
    {
        $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $companyId, $id) {
            $this->guard->require($actor, self::PERMISSION, $companyId);
            $seen = BankRule::query()->where('company_id', $companyId)->find($id) ?? throw DomainRuleViolation::single('not_found', 'The rule does not exist.');
            $r = $this->lock($seen, null);
            $before = $r->attributesToArray();
            $r->delete();
            $audit->add('bank_rule.deleted', $r, before: $before);
        });
    }

    /**
     * Puts the rules in the given order: priority 1..n. The list must name every rule of the company exactly once.
     *
     * @param  list<string>  $ids
     * @return list<BankRule>
     */
    public function reorder(Actor $actor, string $companyId, array $ids): array
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $companyId, $ids) {
            $this->guard->require($actor, self::PERMISSION, $companyId);
            $rules = BankRule::query()->where('company_id', $companyId)->orderBy('id')->lockForUpdate()->get()->keyBy('id');
            if (count($ids) !== count(array_unique($ids)) || count($ids) !== $rules->count() || array_diff($ids, $rules->keys()->all()) !== []) {
                throw DomainRuleViolation::single('rule_order_invalid', 'The order must list every bank rule of the company exactly once.');
            }
            $out = [];
            foreach ($ids as $i => $id) {
                $r = $rules->get($id) ?? throw DomainRuleViolation::single('rule_order_invalid', 'Unknown rule in the order.');
                if ($r->priority !== $i + 1) {
                    $before = $r->attributesToArray();
                    $r->forceFill(['priority' => $i + 1, 'lock_version' => $r->lock_version + 1])->save();
                    $audit->add('bank_rule.reordered', $r, before: $before, after: $r);
                }
                $out[] = $r;
            }

            return $out;
        });
    }

    private function lock(BankRule $r, ?int $version): BankRule
    {
        $locked = BankRule::query()->whereKey($r->id)->lockForUpdate()->firstOrFail();
        if ($version !== null && $locked->lock_version !== $version) {
            throw new VersionConflict($locked->lock_version, $version);
        }

        return $locked;
    }

    private function check(BankRuleInput $in): void
    {
        $c = $in->conditions;
        if (trim($c['contains']) === '') {
            throw DomainRuleViolation::single('rule_condition_invalid', 'A rule needs text to look for.');
        }
        if (! in_array($c['direction'], ['in', 'out', 'any'], true)) {
            throw DomainRuleViolation::single('rule_condition_invalid', 'The direction must be in, out or any.');
        }
        if (isset($c['min_amount'], $c['max_amount']) && $c['min_amount'] > $c['max_amount']) {
            throw DomainRuleViolation::single('rule_condition_invalid', 'The minimum amount is above the maximum.');
        }
        $a = Account::query()->where('company_id', $in->companyId)->find($in->action['account_id']);
        if ($a === null || ! $a->is_active || ! $a->is_postable) {
            throw DomainRuleViolation::single('account_invalid', 'Choose an active account to code to.');
        }
        if (in_array($a->control_type->value, BankTransactionPosting::BLOCKED_CONTROL, true)) {
            throw DomainRuleViolation::single('control_account_not_allowed', "{$a->code} is a control account; rules cannot code to it.");
        }
        if (($in->action['tax_code_id'] ?? null) !== null && ! TaxCode::query()->where('company_id', $in->companyId)->whereKey($in->action['tax_code_id'])->exists()) {
            throw DomainRuleViolation::single('tax_code_invalid', 'Unknown tax code.');
        }
        if (($in->action['contact_id'] ?? null) !== null && ! Contact::query()->where('company_id', $in->companyId)->whereKey($in->action['contact_id'])->exists()) {
            throw DomainRuleViolation::single('not_found', 'The contact does not exist.');
        }
        if ($in->bankAccountId !== null && ! BankAccount::query()->where('company_id', $in->companyId)->whereKey($in->bankAccountId)->exists()) {
            throw DomainRuleViolation::single('not_found', 'The bank account does not exist.');
        }
    }
}
