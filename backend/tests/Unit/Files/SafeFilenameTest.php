<?php

declare(strict_types=1);

use App\Domain\Files\SafeFilename;

it('cleans hostile and awkward names', function (string $input, string $expected): void {
    expect(SafeFilename::clean($input))->toBe($expected);
})->with([
    'plain' => ['invoice 2026-03.pdf', 'invoice 2026-03.pdf'],
    'unix traversal' => ['../../etc/passwd', 'passwd'],
    'windows traversal' => ['..\\..\\boot.ini', 'boot.ini'],
    'absolute' => ['/var/www/shell.php', 'shell.php'],
    'only dots' => ['..', 'file'],
    'empty' => ['', 'file'],
    'hidden' => ['.htaccess', 'htaccess'],
    'crlf header injection' => ["a.pdf\r\nSet-Cookie: x=1", 'a.pdf_Set-Cookie_x_1'],
    'nul cut' => ["ok.pdf\0.exe", 'ok.pdf'],
    'quotes and semicolons' => ['a";filename*=UTF-8\'\'evil.pdf', 'a_filename_UTF-8_evil.pdf'],
    'bidi override' => ["invoice\u{202E}fdp.exe", 'invoice_fdp.exe'],
    'unicode letters kept' => ['Rechnung für März.pdf', 'Rechnung für März.pdf'],
    'only symbols' => ['<>|*?', 'file'],
]);

it('bounds the length and keeps the extension', function (): void {
    $name = SafeFilename::clean(str_repeat('a', 300).'.pdf');

    expect(mb_strlen($name))->toBe(SafeFilename::MAX_LENGTH)->and($name)->toEndWith('.pdf');
});
