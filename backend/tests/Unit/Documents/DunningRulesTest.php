<?php

declare(strict_types=1);

use App\Domain\Documents\DunningRules;

it('counts whole days from the due date', function (): void {
    $due = new DateTimeImmutable('2026-04-14');
    expect(DunningRules::daysOverdue($due, new DateTimeImmutable('2026-04-14')))->toBe(0)
        ->and(DunningRules::daysOverdue($due, new DateTimeImmutable('2026-04-21 23:59')))->toBe(7)
        ->and(DunningRules::daysOverdue($due, new DateTimeImmutable('2026-04-10')))->toBe(-4);
});

it('picks the highest unused stage whose moment is within the catch-up window', function (): void {
    $stages = ['a' => 7, 'b' => 14, 'c' => 30];
    expect(DunningRules::due(6, $stages, []))->toBeNull()
        ->and(DunningRules::due(7, $stages, []))->toBe('a')
        ->and(DunningRules::due(10, $stages, []))->toBe('a')
        ->and(DunningRules::due(11, $stages, []))->toBeNull()
        ->and(DunningRules::due(14, $stages, []))->toBe('b')
        ->and(DunningRules::due(7, $stages, ['a']))->toBeNull()
        ->and(DunningRules::due(60, $stages, []))->toBeNull();
});

it('lets the later stage win when two are inside the window', function (): void {
    expect(DunningRules::due(9, ['a' => 7, 'b' => 9], []))->toBe('b')->and(DunningRules::due(9, ['a' => 7, 'b' => 9], ['b']))->toBe('a');
});
