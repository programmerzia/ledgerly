<?php

declare(strict_types=1);

use App\Domain\Signing\PinPolicy;
use App\Domain\Signing\Signature;

it('accepts ordinary six-digit PINs and rejects weak or malformed ones', function (string $pin, array $codes): void {
    expect(PinPolicy::violations($pin))->toBe($codes);
})->with([
    ['246810', []], ['112233', []], ['908172', []],
    ['12345', ['pin_format']], ['1234567', ['pin_format']], ['12a456', ['pin_format']],
    ['000000', ['pin_repeated']], ['777777', ['pin_repeated']],
    ['123456', ['pin_sequential']], ['654321', ['pin_sequential']], ['456789', ['pin_sequential']],
]);

it('derives a stable signature from the document, its content, the new status, the signer and the time', function (): void {
    $content = Signature::contentHash(['id' => 'doc-1', 'total' => 1000, 'lines' => [['account' => '4000']]]);
    $a = Signature::hash('doc-1', $content, 'posted', 'user-1', '2026-11-01T10:00:00.000000Z');

    expect($a)->toHaveLength(64)
        ->and(Signature::hash('doc-1', $content, 'posted', 'user-1', '2026-11-01T10:00:00.000000Z'))->toBe($a)
        ->and(Signature::hash('doc-1', $content, 'posted', 'user-2', '2026-11-01T10:00:00.000000Z'))->not->toBe($a)
        ->and(Signature::contentHash(['lines' => [['account' => '4000']], 'total' => 1000, 'id' => 'doc-1']))->toBe($content);
});
