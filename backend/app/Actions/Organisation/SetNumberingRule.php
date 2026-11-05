<?php

declare(strict_types=1);

namespace App\Actions\Organisation;

use App\Actions\Ledger\SetupGuard;
use App\Contracts\IdGenerator;
use App\Domain\Organisation\NumberingKinds;
use App\Domain\Shared\DomainRuleViolation;
use App\Models\Fiscal\FiscalYear;
use App\Models\Organisation\Company;
use App\Models\Organisation\NumberingRule;
use App\Queries\Organisation\NumberingOverview;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;
use App\Support\UnitOfWork\VersionConflict;

/**
 * Changes the prefix and padding of a document kind from the next fiscal year only (D15 item 6, `settings.manage`, people only).
 *
 * Nothing is renumbered: the change is a rule dated from the start of the first fiscal year after the current one whose sequence for the
 * kind does not exist yet, and `SequenceAllocator` reads it only when that year's sequence is first created. Sequences that exist keep
 * their prefix, padding and counter. The company row is locked so two changes cannot race on the cross-kind uniqueness check.
 *
 * Uniqueness: two kinds must never produce the same number. The new prefix is refused if any other kind will use it in the year the
 * change starts or in any later year it has a rule for (kinds without a rule count with their built-in prefix).
 */
final class SetNumberingRule
{
    public function __construct(
        private readonly UnitOfWork $uow,
        private readonly IdGenerator $ids,
        private readonly SetupGuard $guard,
        private readonly NumberingOverview $overview,
    ) {}

    /**
     * @param  int|null  $version  the `version` of the pending change the person saw; null when they saw none
     * @return array{from: string, fiscal_year: string|null, unchanged: bool}
     */
    public function handle(Actor $actor, string $companyId, string $kind, string $prefix, int $padding, ?int $version): array
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $companyId, $kind, $prefix, $padding, $version) {
            $this->guard->require($actor, 'settings.manage', $companyId);
            if (! isset(NumberingKinds::KINDS[$kind])) {
                throw DomainRuleViolation::single('numbering_kind_unknown', "{$kind} is not a numbered document kind.");
            }
            $problems = NumberingKinds::prefixProblems($prefix);
            if ($problems !== []) {
                throw DomainRuleViolation::single('numbering_prefix_invalid', $problems[0]);
            }
            if (! NumberingKinds::paddingValid($padding)) {
                throw DomainRuleViolation::single('numbering_padding_invalid', 'Padding is between '.NumberingKinds::MIN_PADDING.' and '.NumberingKinds::MAX_PADDING.' digits.');
            }

            Company::query()->whereKey($companyId)->lock('FOR NO KEY UPDATE')->firstOrFail();
            $current = $this->overview->currentYear($companyId);
            $years = FiscalYear::query()->where('company_id', $companyId)->orderBy('starts_on')->get()->values()->all();
            $effective = $this->overview->effectiveFrom($companyId, $kind, $current, $years);
            $from = $effective['from'];

            /** @var list<NumberingRule> $all */
            $all = NumberingRule::query()->where('company_id', $companyId)->orderBy('effective_from')->get()->all();
            $own = array_values(array_filter($all, fn (NumberingRule $r) => $r->doc_kind === $kind));
            $pending = null;
            $inForce = null;
            foreach ($own as $r) {
                if ($r->effective_from->format('Y-m-d') < $from) {
                    $inForce = $r;
                } else {
                    $pending = $r;
                }
            }
            if ($pending !== null && $version !== null && $pending->lock_version !== $version) {
                throw new VersionConflict($pending->lock_version, $version);
            }

            $this->requireUnique($all, $kind, $prefix, $from);

            // The same as what the year would use anyway: drop the waiting change instead of storing a copy.
            $sameAsInForce = ($inForce->prefix ?? NumberingKinds::defaultPrefix($kind)) === $prefix && ($inForce->padding ?? NumberingKinds::DEFAULT_PADDING) === $padding;
            if ($sameAsInForce) {
                if ($pending !== null) {
                    $audit->add('numbering.rule_cancelled', $pending, before: $pending, context: ['kind' => $kind]);
                    $pending->delete();
                }

                return ['from' => $from, 'fiscal_year' => $effective['fiscal_year'], 'unchanged' => true];
            }

            if ($pending !== null) {
                $before = $pending->attributesToArray();
                $pending->forceFill([
                    'prefix' => $prefix, 'padding' => $padding, 'effective_from' => $from, 'lock_version' => $pending->lock_version + 1, 'created_by' => $actor->id,
                ])->save();
                $audit->add('numbering.rule_changed', $pending, before: $before, after: $pending, context: ['kind' => $kind]);
            } else {
                $rule = new NumberingRule;
                $rule->forceFill([
                    'id' => $this->ids->next(), 'tenant_id' => $actor->tenantId, 'company_id' => $companyId, 'doc_kind' => $kind,
                    'prefix' => $prefix, 'padding' => $padding, 'effective_from' => $from, 'created_by' => $actor->id,
                ])->save();
                $audit->add('numbering.rule_set', $rule, after: $rule, context: ['kind' => $kind]);
            }

            return ['from' => $from, 'fiscal_year' => $effective['fiscal_year'], 'unchanged' => false];
        });
    }

    /** @param list<NumberingRule> $rules every rule of the company */
    private function requireUnique(array $rules, string $kind, string $prefix, string $from): void
    {
        foreach (NumberingKinds::KINDS as $other => $meta) {
            if ($other === $kind) {
                continue;
            }
            $prefixes = [$meta['prefix']];   // before its first rule a kind uses the built-in prefix
            $atFrom = null;
            foreach ($rules as $r) {
                if ($r->doc_kind !== $other) {
                    continue;
                }
                if ($r->effective_from->format('Y-m-d') <= $from) {
                    $atFrom = $r->prefix;
                } else {
                    $prefixes[] = $r->prefix;
                }
            }
            $inUse = $atFrom !== null ? [$atFrom, ...array_slice($prefixes, 1)] : $prefixes;
            if (in_array($prefix, $inUse, true)) {
                throw DomainRuleViolation::single('numbering_prefix_in_use', "{$prefix} is used by {$meta['label']} numbers; two kinds must not produce the same number.");
            }
        }
    }
}
