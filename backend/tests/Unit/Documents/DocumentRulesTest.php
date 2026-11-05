<?php

declare(strict_types=1);

use App\Domain\Documents\AmountInWords;
use App\Domain\Documents\DocMoney;
use App\Domain\Documents\MessageTemplate;
use App\Domain\Documents\Percent;

it('writes amounts in words from integer minor units', function (int $minor, int $decimals, string $currency, ?string $words): void {
    expect(AmountInWords::of($minor, $decimals, $currency))->toBe($words);
})->with([
    [0, 2, 'USD', 'Zero and 00/100 USD'],
    [123456, 2, 'USD', 'One thousand two hundred thirty-four and 56/100 USD'],
    [100000000, 2, 'EUR', 'One million and 00/100 EUR'],
    [1000015, 2, 'USD', 'Ten thousand and 15/100 USD'],
    [21, 0, 'JPY', 'Twenty-one JPY'],
    [1500, 3, 'KWD', 'One and 500/1000 KWD'],
    [2000000100, 2, 'USD', 'Twenty million one and 00/100 USD'],
    [-5, 2, 'USD', null],
]);

it('formats minor units with the currency decimals and grouped thousands, without floats', function (): void {
    $usd = new DocMoney('USD', 2);
    expect($usd->plain(123456789))->toBe('1,234,567.89')->and($usd->plain(5))->toBe('0.05')->and($usd->plain(-100050))->toBe('-1,000.50')
        ->and($usd->withCode(1000))->toBe('USD 10.00')
        ->and((new DocMoney('JPY', 0))->plain(1234567))->toBe('1,234,567')
        ->and((new DocMoney('KWD', 3))->plain(1500))->toBe('1.500')
        ->and($usd->plain(PHP_INT_MAX))->toBe('92,233,720,368,547,758.07');
});

it('turns rate fractions into percentages and trims decimals', function (): void {
    expect(Percent::ofFraction('0.160000'))->toBe('16%')->and(Percent::ofFraction('0.0725'))->toBe('7.25%')->and(Percent::ofFraction('0.000000'))->toBe('0%')
        ->and(Percent::ofFraction('1.0'))->toBe('100%')->and(Percent::ofFraction('x'))->toBe('')
        ->and(Percent::trim('2.0000'))->toBe('2')->and(Percent::trim('1.5000'))->toBe('1.5')->and(Percent::trim('10'))->toBe('10');
});

it('substitutes only the allowlisted placeholders and never evaluates anything', function (): void {
    $values = ['contact_name' => 'Ann <b>Lee</b>', 'total' => 'USD 10.00'];
    expect(MessageTemplate::render('Hi {{ contact_name }}, {{total}} {{ nothing }} {{ company_name }}', $values))->toBe('Hi Ann <b>Lee</b>, USD 10.00  ')
        ->and(MessageTemplate::render('{{ system("id") }} {{ $x }} @php echo 1; @endphp {!! x !!}', $values))->toBe('{{ system("id") }} {{ $x }} @php echo 1; @endphp {!! x !!}')
        ->and(MessageTemplate::unknown('{{ total }} {{ nope }} {{ system("id") }}'))->toBe(['nope', 'system("id")'])
        ->and(MessageTemplate::unknown('Plain text {{total}}'))->toBe([]);
});
