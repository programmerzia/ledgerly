<?php

declare(strict_types=1);

use App\Domain\Tax\TaxCalculator;
use App\Domain\Tax\TaxComponent;
use App\Domain\Tax\TaxLine;
use App\Domain\Tax\TaxRatePeriod;
use App\Domain\Tax\TaxRates;
use App\Domain\Tax\TaxResult;
use App\Domain\Tax\TaxRounding;

/*
 * D2 (13 §23), numbers worked out by hand. Amounts are minor units; rates are fractions as strings.
 */

function vat(string $rate = '0.05', string $id = 'VAT'): array
{
    return [new TaxComponent($id, $rate)];
}

function taxes(TaxResult $r): array
{
    return array_map(fn ($l) => $l->tax, $r->lines);
}

it('rounds the sum once and allocates by largest remainder', function (): void {
    // 5% of 110 = 5.50 per line; 3 lines sum to 16.50 -> 17. Floors 5+5+5 = 15, 2 left, remainders tie -> lines 1 and 2.
    $lines = [new TaxLine(110, vat()), new TaxLine(110, vat()), new TaxLine(110, vat())];
    $r = TaxCalculator::calculate($lines);
    expect(taxes($r))->toBe([6, 6, 5])->and($r->tax)->toBe(17)->and($r->byCode)->toBe(['VAT' => 17])
        ->and($r->net)->toBe(330)->and($r->gross)->toBe(347);

    // Per line each 5.50 rounds up on its own: 18.
    $line = TaxCalculator::calculate($lines, TaxRounding::Line);
    expect(taxes($line))->toBe([6, 6, 6])->and($line->tax)->toBe(18);
});

it('gives the leftover unit to the largest remainder, not the first line', function (): void {
    // 7%: 333 -> 23.31, 333 -> 23.31, 334 -> 23.38. Sum 70.00 exactly. Floors 69, one left, largest remainder .38 -> line 3.
    $r = TaxCalculator::calculate([new TaxLine(333, vat('0.07')), new TaxLine(333, vat('0.07')), new TaxLine(334, vat('0.07'))]);
    expect(taxes($r))->toBe([23, 23, 24])->and($r->tax)->toBe(70);
    // Line mode rounds 23.31, 23.31, 23.38 each to 23: one unit lost.
    expect(TaxCalculator::calculate([new TaxLine(333, vat('0.07')), new TaxLine(333, vat('0.07')), new TaxLine(334, vat('0.07'))], TaxRounding::Line)->tax)->toBe(69);
});

it('matches the documented example: 5% on 0.10 twice is 0.01 per code and 0.02 per line', function (): void {
    $lines = [new TaxLine(10, vat()), new TaxLine(10, vat())];
    expect(TaxCalculator::calculate($lines)->tax)->toBe(1)
        ->and(taxes(TaxCalculator::calculate($lines)))->toBe([1, 0])
        ->and(TaxCalculator::calculate($lines, TaxRounding::Line)->tax)->toBe(2);
});

it('works per tax code, and an untaxed line carries none', function (): void {
    // VAT 10% on 105 (10.5) and 105 (10.5): sum 21. Levy 2% on 105 (2.1) only: 2. Untaxed 50.
    $lines = [
        new TaxLine(105, [new TaxComponent('VAT', '0.10'), new TaxComponent('LEVY', '0.02')]),
        new TaxLine(105, vat('0.10')),
        new TaxLine(50),
    ];
    $r = TaxCalculator::calculate($lines);
    expect($r->byCode)->toBe(['VAT' => 21, 'LEVY' => 2])
        ->and($r->lines[0]->byCode)->toBe(['VAT' => 11, 'LEVY' => 2])->and($r->lines[0]->tax)->toBe(13)
        ->and($r->lines[1]->tax)->toBe(10)->and($r->lines[2]->tax)->toBe(0)
        ->and($r->net)->toBe(260)->and($r->tax)->toBe(23)->and($r->gross)->toBe(283);
});

it('splits tax out of a tax-inclusive price', function (): void {
    // 100 gross at 5%: tax = 100 x 0.05 / 1.05 = 4.7619 -> 5, net 95.
    $one = TaxCalculator::calculate([new TaxLine(100, vat(), inclusive: true)]);
    expect($one->lines[0]->tax)->toBe(5)->and($one->lines[0]->net)->toBe(95)->and($one->gross)->toBe(100);

    // Two such lines: 9.5238 -> 10 for the document; floors 4+4, both remainders .7619 -> [5, 5]. Net 190, gross 200.
    $two = TaxCalculator::calculate([new TaxLine(100, vat(), inclusive: true), new TaxLine(100, vat(), inclusive: true)]);
    expect(taxes($two))->toBe([5, 5])->and($two->net)->toBe(190)->and($two->gross)->toBe(200);

    // 105 gross at 5% is exactly 100 net.
    $exact = TaxCalculator::calculate([new TaxLine(105, vat(), inclusive: true)]);
    expect($exact->lines[0]->net)->toBe(100)->and($exact->lines[0]->tax)->toBe(5);
});

it('charges a compound tax on the net plus the earlier taxes', function (): void {
    $group = [new TaxComponent('STATE', '0.10'), new TaxComponent('CITY', '0.05', compound: true)];
    // Net 1000: STATE 100, CITY (1000 + 100) x 5% = 55.
    $r = TaxCalculator::calculate([new TaxLine(1000, $group)]);
    expect($r->byCode)->toBe(['STATE' => 100, 'CITY' => 55])->and($r->gross)->toBe(1155);

    // Without compounding CITY would be 50.
    $plain = TaxCalculator::calculate([new TaxLine(1000, [new TaxComponent('STATE', '0.10'), new TaxComponent('CITY', '0.05')])]);
    expect($plain->byCode['CITY'])->toBe(50);

    // Inclusive 1155 = 1000 x (1 + 0.10 + 0.055): the same split back out.
    $inc = TaxCalculator::calculate([new TaxLine(1155, $group, inclusive: true)]);
    expect($inc->byCode)->toBe(['STATE' => 100, 'CITY' => 55])->and($inc->net)->toBe(1000);
});

it('rounds ties away from zero for credit lines', function (): void {
    // -105 x 10% = -10.5 -> -11.
    $r = TaxCalculator::calculate([new TaxLine(-105, vat('0.10'))]);
    expect($r->tax)->toBe(-11)->and($r->gross)->toBe(-116);

    // A mixed document: 110 and -55 at 5% -> 5.5 and -2.75 -> sum 2.75 -> 3. Floors 5 + -3 = 2, one left, remainders .5 and .25 -> line 1.
    $mixed = TaxCalculator::calculate([new TaxLine(110, vat()), new TaxLine(-55, vat())]);
    expect(taxes($mixed))->toBe([6, -3])->and($mixed->tax)->toBe(3);
});

it('always sums the line taxes to the document tax per code', function (): void {
    mt_srand(7);
    for ($n = 0; $n < 200; $n++) {
        $lines = [];
        for ($i = 0, $count = mt_rand(1, 8); $i < $count; $i++) {
            $lines[] = new TaxLine(mt_rand(-5000, 90000), vat((string) (mt_rand(1, 300) / 1000)), inclusive: mt_rand(0, 1) === 1);
        }
        $r = TaxCalculator::calculate($lines);
        expect(array_sum(taxes($r)))->toBe($r->tax)->and($r->gross - $r->net)->toBe($r->tax);
        foreach ($lines as $i => $line) {
            expect($r->lines[$i]->net + $r->lines[$i]->tax)->toBe($r->lines[$i]->gross);
            if ($line->inclusive) {
                expect($r->lines[$i]->gross)->toBe($line->amount);
            }
        }
    }
});

it('looks a rate up by effective date', function (): void {
    $periods = [
        new TaxRatePeriod('0.050000', new DateTimeImmutable('2025-01-01'), new DateTimeImmutable('2026-06-30')),
        new TaxRatePeriod('0.075000', new DateTimeImmutable('2026-07-01')),
    ];
    expect(TaxRates::on($periods, new DateTimeImmutable('2024-12-31')))->toBeNull()
        ->and(TaxRates::on($periods, new DateTimeImmutable('2025-01-01')))->toBe('0.050000')
        ->and(TaxRates::on($periods, new DateTimeImmutable('2026-06-30 23:59')))->toBe('0.050000')
        ->and(TaxRates::on($periods, new DateTimeImmutable('2026-07-01')))->toBe('0.075000')
        ->and(TaxRates::on($periods, new DateTimeImmutable('2040-01-01')))->toBe('0.075000')
        ->and($periods[0]->overlaps($periods[1]))->toBeFalse()
        ->and((new TaxRatePeriod('0.1', new DateTimeImmutable('2026-06-30')))->overlaps($periods[0]))->toBeTrue();
});
