<?php

declare(strict_types=1);

namespace App\Actions\Ledger;

use App\Domain\Ledger\DimensionRule;
use App\Domain\Shared\DomainRuleViolation;
use App\Models\Ledger\Account;
use App\Models\Ledger\AccountDimensionRule;
use App\Models\Ledger\Dimension;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;

/**
 * Replaces the dimension rules of one account: for each listed dimension, a line on this account must
 * (required), may (optional) or must not (forbidden) carry a value. Unlisted dimensions have no rule.
 * The posting validator enforces them from then on (13 §9).
 */
final class SetAccountDimensionRules
{
    public function __construct(private readonly UnitOfWork $uow, private readonly SetupGuard $guard) {}

    /**
     * @param  array<string, DimensionRule>  $rules  dimension id → rule
     * @return array<string, DimensionRule> the rules now in force
     */
    public function handle(Actor $actor, string $accountId, array $rules): array
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $accountId, $rules) {
            $account = $locks->document(Account::query()->findOrFail($accountId));
            $this->guard->require($actor, 'accounts.manage', $account->company_id, tokens: true);

            $known = Dimension::query()->where('company_id', $account->company_id)->whereIn('id', array_keys($rules))->pluck('id')->all();
            if (count($known) !== count($rules)) {
                throw DomainRuleViolation::single('dimension_not_found', 'Every rule must name a dimension of this company.');
            }

            $before = $this->current($account->id);
            AccountDimensionRule::query()->where('account_id', $account->id)->delete();
            if ($rules !== []) {
                AccountDimensionRule::query()->insert(array_map(fn (string $dimensionId, DimensionRule $rule) => [
                    'tenant_id' => $actor->tenantId, 'company_id' => $account->company_id,
                    'account_id' => $account->id, 'dimension_id' => $dimensionId, 'rule' => $rule->value,
                ], array_keys($rules), array_values($rules)));
            }
            $after = $this->current($account->id);
            $audit->add('account.dimension_rules_set', $account, before: ['rules' => $before], after: ['rules' => $after]);

            return array_map(fn (string $rule) => DimensionRule::from($rule), $after);
        });
    }

    /** @return array<string, string> dimension id → rule */
    private function current(string $accountId): array
    {
        $out = [];
        foreach (AccountDimensionRule::query()->where('account_id', $accountId)->orderBy('dimension_id')->get() as $row) {
            $out[$row->dimension_id] = $row->rule->value;
        }

        return $out;
    }
}
