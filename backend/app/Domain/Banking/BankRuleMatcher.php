<?php

declare(strict_types=1);

namespace App\Domain\Banking;

/**
 * Bank rules (14 E1): ordered, first match wins. A rule's conditions are `contains` (case-insensitive, over the
 * description, counterparty and reference; empty never matches), `direction` (in|out|any) and an optional
 * `min_amount` / `max_amount` on the absolute amount. Same behaviour as the mock's matchBankRule.
 */
final class BankRuleMatcher
{
    /**
     * @param  array{amount: int, description: string, counterparty: string|null, reference: string|null}  $line
     * @param  list<array{id: string, priority: int, is_active: bool, conditions: array<string, mixed>}>  $rules
     * @return string|null the matching rule's id
     */
    public static function firstMatch(array $line, array $rules): ?string
    {
        usort($rules, fn (array $a, array $b): int => $a['priority'] <=> $b['priority'] ?: strcmp($a['id'], $b['id']));
        $haystack = mb_strtolower($line['description'].' '.($line['counterparty'] ?? '').' '.($line['reference'] ?? ''));
        $gross = abs($line['amount']);
        $direction = $line['amount'] >= 0 ? 'in' : 'out';

        foreach ($rules as $rule) {
            if (! $rule['is_active']) {
                continue;
            }
            $c = $rule['conditions'];
            $contains = trim((string) ($c['contains'] ?? ''));
            $dir = (string) ($c['direction'] ?? 'any');
            if ($contains === '' || ! str_contains($haystack, mb_strtolower($contains))) {
                continue;
            }
            if ($dir !== 'any' && $dir !== $direction) {
                continue;
            }
            if (isset($c['min_amount']) && $gross < (int) $c['min_amount']) {
                continue;
            }
            if (isset($c['max_amount']) && $gross > (int) $c['max_amount']) {
                continue;
            }

            return $rule['id'];
        }

        return null;
    }
}
