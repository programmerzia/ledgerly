<?php

declare(strict_types=1);

namespace App\Actions\Banking;

use App\Actions\Banking\Inputs\BankTransactionInput;
use App\Domain\Banking\BankRuleMatcher;
use App\Domain\Shared\DomainRuleViolation;
use App\Models\Banking\BankRule;
use App\Models\Banking\BankStatementLine;
use App\Models\Banking\BankTransaction;
use App\Queries\Ledger\DimensionPositions;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;

/**
 * Applies a bank rule to a line: the rule's coding becomes a bank transaction (spend for money out, receive for money in) with the
 * VAT split by its tax code, in the bank's currency. A rule only suggests; this is the person's confirmation (14 E1), so it needs the
 * same permission and the same posting rules as coding the line by hand. Without `ruleId` the first matching active rule is used.
 */
final class ApplyBankRule
{
    public function __construct(private readonly UnitOfWork $uow, private readonly CreateBankTransaction $create, private readonly DimensionPositions $positions) {}

    public function handle(Actor $actor, string $companyId, string $lineId, ?string $ruleId): BankTransaction
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $companyId, $lineId, $ruleId) {
            $line = BankStatementLine::query()->where('company_id', $companyId)->find($lineId) ?? throw DomainRuleViolation::single('not_found', 'The bank line does not exist.');
            $rules = BankRule::query()->where('company_id', $companyId)->where('is_active', true)
                ->where(fn ($q) => $q->whereNull('bank_account_id')->orWhere('bank_account_id', $line->bank_account_id))->get();
            $candidates = $rules->map(fn (BankRule $r): array => ['id' => $r->id, 'priority' => $r->priority, 'is_active' => true, 'conditions' => $r->conditions])->all();
            $shape = ['amount' => $line->amount, 'description' => $line->description, 'counterparty' => $line->counterparty, 'reference' => $line->reference];

            if ($ruleId !== null) {
                $chosen = $rules->firstWhere('id', $ruleId) ?? throw DomainRuleViolation::single('not_found', 'The rule does not exist or does not apply to this account.');
                $mine = array_values(array_filter($candidates, fn (array $c): bool => $c['id'] === $chosen->id));
                if (BankRuleMatcher::firstMatch($shape, $mine) === null) {
                    throw DomainRuleViolation::single('rule_not_applicable', 'The rule does not match this line.');
                }
            } else {
                $id = BankRuleMatcher::firstMatch($shape, array_values($candidates)) ?? throw DomainRuleViolation::single('no_rule_matches', 'No rule matches this line.');
                $chosen = $rules->firstWhere('id', $id) ?? throw DomainRuleViolation::single('no_rule_matches', 'No rule matches this line.');
            }

            $action = $chosen->action;
            $slots = array_flip(($this->positions)($companyId));
            $dims = [];
            foreach ((array) ($action['dimensions'] ?? []) as $dimensionId => $valueId) {
                if (isset($slots[(string) $dimensionId])) {
                    $dims[$slots[(string) $dimensionId]] = (string) $valueId;
                }
            }

            return $this->create->handle($actor, new BankTransactionInput(
                $companyId, $line->id, $line->amount > 0 ? 'receive' : 'spend', (string) $action['account_id'], null,
                isset($action['tax_code_id']) ? (string) $action['tax_code_id'] : null, isset($action['contact_id']) ? (string) $action['contact_id'] : null,
                $dims, isset($action['memo']) ? (string) $action['memo'] : null, $chosen->id,
            ));
        });
    }
}
