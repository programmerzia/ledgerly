<?php

declare(strict_types=1);

use App\Domain\Fiscal\CalendarType;
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

it('cuts a 4-4-5 year into 52 whole weeks, each quarter 4+4+5', function () {
    $periods = FiscalCalendar::weekBased(CalendarType::Weeks445, new DateTimeImmutable('2027-01-01'));
    $weeks = fn ($p) => ($p->endsOn->diff($p->startsOn)->days + 1) / 7;

    expect($periods)->toHaveCount(13)
        ->and(array_map($weeks, array_slice($periods, 0, 12)))->toBe([4, 4, 5, 4, 4, 5, 4, 4, 5, 4, 4, 5])
        ->and($periods[0]->startsOn->format('Y-m-d'))->toBe('2027-01-01')
        ->and($periods[0]->endsOn->format('Y-m-d'))->toBe('2027-01-28')
        ->and($periods[2]->endsOn->format('Y-m-d'))->toBe('2027-04-01')
        ->and($periods[11]->endsOn->format('Y-m-d'))->toBe('2027-12-30')
        ->and($periods[12]->kind)->toBe(PeriodKind::Adjustment)
        ->and($periods[12]->startsOn->format('Y-m-d'))->toBe('2027-12-30')
        ->and($periods[12]->endsOn->format('Y-m-d'))->toBe('2027-12-30');

    for ($i = 1; $i < 12; $i++) {
        expect($periods[$i]->startsOn->format('Y-m-d'))->toBe($periods[$i - 1]->endsOn->modify('+1 day')->format('Y-m-d'));
    }
});

it('supports 4-5-4 and 5-4-4 patterns', function (CalendarType $type, array $firstQuarter) {
    $periods = FiscalCalendar::plan($type, new DateTimeImmutable('2026-02-02'));
    $weeks = array_map(fn ($p) => ($p->endsOn->diff($p->startsOn)->days + 1) / 7, array_slice($periods, 0, 12));

    expect(array_slice($weeks, 0, 3))->toBe($firstQuarter)->and(array_sum($weeks))->toBe(52)
        ->and($periods[11]->endsOn->format('Y-m-d'))->toBe('2027-01-31');
})->with([[CalendarType::Weeks454, [4, 5, 4]], [CalendarType::Weeks544, [5, 4, 4]]]);

it('gives the extra week of a 53-week year to the period that is chosen', function (int $extra) {
    $periods = FiscalCalendar::plan(CalendarType::Weeks445, new DateTimeImmutable('2027-01-01'), $extra);
    $regular = array_slice($periods, 0, 12);
    $days = array_sum(array_map(fn ($p) => $p->endsOn->diff($p->startsOn)->days + 1, $regular));
    $base = [4, 4, 5, 4, 4, 5, 4, 4, 5, 4, 4, 5];
    $base[$extra - 1]++;

    expect($days)->toBe(371)
        ->and(array_map(fn ($p) => ($p->endsOn->diff($p->startsOn)->days + 1) / 7, $regular))->toBe($base)
        ->and($regular[11]->endsOn->format('Y-m-d'))->toBe('2028-01-06');
    for ($i = 1; $i < 12; $i++) {
        expect($regular[$i]->startsOn->format('Y-m-d'))->toBe($regular[$i - 1]->endsOn->modify('+1 day')->format('Y-m-d'));
    }
})->with([1, 5, 12]);

it('refuses an extra week on a monthly year or in a period that does not exist', function () {
    expect(fn () => FiscalCalendar::plan(CalendarType::Monthly, new DateTimeImmutable('2026-01-01'), 3))->toThrow(DomainRuleViolation::class)
        ->and(fn () => FiscalCalendar::plan(CalendarType::Weeks445, new DateTimeImmutable('2026-01-05'), 13))->toThrow(DomainRuleViolation::class)
        ->and(fn () => FiscalCalendar::plan(CalendarType::Weeks445, new DateTimeImmutable('2026-01-05'), 0))->toThrow(DomainRuleViolation::class);
});

it('keeps plan() for monthly identical to monthly()', function () {
    $start = new DateTimeImmutable('2026-04-01');
    expect(FiscalCalendar::plan(CalendarType::Monthly, $start))->toEqual(FiscalCalendar::monthly($start));
});
