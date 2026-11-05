<?php

declare(strict_types=1);

use App\Domain\Shared\FormatPreferences;

it('formats a date in each supported style', function (string $key, string $expected) {
    $f = new FormatPreferences($key, 'comma_dot');

    expect($f->date('2026-03-05'))->toBe($expected)
        ->and($f->date(new DateTimeImmutable('2026-03-05')))->toBe($expected)
        ->and($f->date('2026-03-05T10:30:00Z'))->toBe($expected);
})->with([['dmy', '05/03/2026'], ['mdy', '03/05/2026'], ['ymd', '2026-03-05'], ['d_mon_y', '05 Mar 2026']]);

it('leaves what is not a date alone', function () {
    $f = new FormatPreferences('dmy', 'comma_dot');

    expect($f->date(null))->toBe('')->and($f->date(''))->toBe('')->and($f->date('Opening balance'))->toBe('Opening balance')
        ->and($f->date('2026-02-30'))->toBe('2026-02-30');
});

it('formats integer minor units with the chosen separators and the currency decimals', function (string $key, string $expected) {
    $f = new FormatPreferences('ymd', $key);

    expect($f->number(123456789, 2))->toBe($expected);
})->with([
    ['comma_dot', '1,234,567.89'], ['dot_comma', '1.234.567,89'], ['space_comma', "1\u{202F}234\u{202F}567,89"], ['apostrophe_dot', "1\u{2019}234\u{2019}567.89"],
]);

it('keeps zero-decimal currencies whole and small amounts padded', function () {
    $f = new FormatPreferences('ymd', 'dot_comma');

    expect($f->number(1500000, 0))->toBe('1.500.000')->and($f->number(5, 2))->toBe('0,05')->and($f->number(-5, 2))->toBe('-0,05')->and($f->number(0, 2))->toBe('0,00')
        ->and($f->number(1234567, 3))->toBe('1.234,567');
});

it('defaults from the country, and a choice wins over the country', function () {
    expect(FormatPreferences::forCountry('US'))->toEqual(new FormatPreferences('mdy', 'comma_dot'))
        ->and(FormatPreferences::forCountry('KE'))->toEqual(new FormatPreferences('dmy', 'comma_dot'))
        ->and(FormatPreferences::forCountry('DE'))->toEqual(new FormatPreferences('dmy', 'dot_comma'))
        ->and(FormatPreferences::forCountry('FR'))->toEqual(new FormatPreferences('dmy', 'space_comma'))
        ->and(FormatPreferences::forCountry('CH'))->toEqual(new FormatPreferences('d_mon_y', 'apostrophe_dot'))
        ->and(FormatPreferences::forCountry('JP'))->toEqual(new FormatPreferences('ymd', 'comma_dot'))
        ->and(FormatPreferences::forCountry('ZZ'))->toEqual(new FormatPreferences('d_mon_y', 'comma_dot'))
        ->and(FormatPreferences::forCountry(null))->toEqual(new FormatPreferences('d_mon_y', 'comma_dot'));

    expect(FormatPreferences::resolve('ymd', null, 'DE'))->toEqual(new FormatPreferences('ymd', 'dot_comma'))
        ->and(FormatPreferences::resolve('nonsense', 'nonsense', 'US'))->toEqual(new FormatPreferences('mdy', 'comma_dot'));
});

it('turns the dates inside a sentence into the company format', function () {
    expect((new FormatPreferences('dmy', 'comma_dot'))->datesIn('Acme · 2026-01-01 to 2026-01-31, 12 lines'))->toBe('Acme · 01/01/2026 to 31/01/2026, 12 lines');
});

it('refuses an unknown key', function () {
    new FormatPreferences('weird', 'comma_dot');
})->throws(InvalidArgumentException::class);
