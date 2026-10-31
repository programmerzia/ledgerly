<?php

declare(strict_types=1);

use App\Domain\Fiscal\FiscalCalendar;
use App\Domain\Fiscal\PeriodKind;
use App\Domain\Shared\DomainRuleViolation;

it('builds 12 contiguous months plus the adjustment period (D7)', function () {
    $periods = FiscalCalendar::monthly(new DateTimeImmutable('2027-07-01'));

    expect($periods)->toHaveCount(13)
        ->and($periods[0]->startsOn->format('Y-m-d'))->toBe('2027-07-01')
        ->and($periods[7]->endsOn->format('Y-m-d'))->toBe('2028-02-29')
        ->and($periods[11]->endsOn->format('Y-m-d'))->toBe('2028-06-30')
        ->and($periods[12]->kind)->toBe(PeriodKind::Adjustment)
        ->and($periods[12]->startsOn->format('Y-m-d'))->toBe('2028-06-30');

    for ($i = 1; $i < 12; $i++) {
        expect($periods[$i]->startsOn->format('Y-m-d'))->toBe($periods[$i - 1]->endsOn->modify('+1 day')->format('Y-m-d'));
    }
});

it('rejects a year not starting on the first of a month', function () {
    FiscalCalendar::monthly(new DateTimeImmutable('2026-01-15'));
})->throws(DomainRuleViolation::class);
