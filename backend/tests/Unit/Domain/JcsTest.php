<?php

declare(strict_types=1);

use App\Domain\Audit\Jcs;

it('sorts keys by UTF-16 code units and emits no whitespace', function () {
    expect(Jcs::encode(['b' => 1, 'a' => [true, null, 'x'], '€' => 0, "\u{1F600}" => 1, "\u{FB01}" => 2]))
        ->toBe('{"a":[true,null,"x"],"b":1,"€":0,"😀":1,"ﬁ":2}');
});

it('escapes strings like ECMAScript JSON.stringify', function () {
    expect(Jcs::encode("q\"\\/\n\t\u{1}\u{2028}é"))->toBe('"q\"\\\\/\n\t\u0001'."\u{2028}".'é"');
});

it('emits integers beyond 2^53 as strings', function () {
    expect(Jcs::encode(['big' => PHP_INT_MAX, 'safe' => 9007199254740991]))
        ->toBe('{"big":"9223372036854775807","safe":9007199254740991}');
});

it('rejects floats', function () {
    Jcs::encode(['rate' => 1.5]);
})->throws(InvalidArgumentException::class);

it('encodes empty map and list distinctly', function () {
    expect(Jcs::encode([]))->toBe('[]')->and(Jcs::encode(['k' => []]))->toBe('{"k":[]}');
});
