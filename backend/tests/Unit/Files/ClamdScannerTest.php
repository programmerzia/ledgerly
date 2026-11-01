<?php

declare(strict_types=1);

use App\Services\Files\ClamdScanner;
use App\Support\Files\ScannerRejected;
use App\Support\Files\ScannerUnavailable;

/** A stream wrapper standing in for the clamd socket: records what is written, answers with a canned reply. */
final class FakeClamdStream
{
    public static string $reply = "stream: OK\0";

    public static string $written = '';

    public static bool $failWrites = false;

    /** @var resource|null */
    public $context;

    private int $read = 0;

    public function stream_open(string $path, string $mode, int $options, ?string &$opened): bool
    {
        return true;
    }

    public function stream_write(string $data): int
    {
        if (self::$failWrites) {
            return 0;
        }
        self::$written .= $data;

        return strlen($data);
    }

    public function stream_read(int $count): string|false
    {
        $chunk = substr(self::$reply, $this->read, $count);
        $this->read += strlen($chunk);

        return $chunk;
    }

    public function stream_eof(): bool
    {
        return $this->read >= strlen(self::$reply);
    }

    /** @return array<string, mixed> */
    public function stream_stat(): array
    {
        return [];
    }

    public function stream_set_option(int $option, int $arg1, ?int $arg2): bool
    {
        return false;
    }

    public function stream_close(): void {}
}

beforeEach(function (): void {
    stream_wrapper_register('fakeclamd', FakeClamdStream::class);
    FakeClamdStream::$reply = "stream: OK\0";
    FakeClamdStream::$written = '';
    FakeClamdStream::$failWrites = false;
});

afterEach(function (): void {
    stream_wrapper_unregister('fakeclamd');
});

function scanner(int $chunk = 4, bool $reachable = true): ClamdScanner
{
    return new ClamdScanner(fn () => $reachable ? fopen('fakeclamd://clamd', 'r+') : false, $chunk);
}

function memory(string $data)
{
    $s = fopen('php://memory', 'r+');
    fwrite($s, $data);
    rewind($s);

    return $s;
}

it('speaks INSTREAM: command, length-prefixed chunks, a zero-length terminator', function (): void {
    $result = scanner(chunk: 4)->scan(memory('abcdefghij'));

    expect($result->clean)->toBeTrue()->and($result->signature)->toBeNull()
        ->and(FakeClamdStream::$written)->toBe("zINSTREAM\0".pack('N', 4).'abcd'.pack('N', 4).'efgh'.pack('N', 2).'ij'.pack('N', 0));
});

it('sends just the terminator for an empty stream', function (): void {
    scanner()->scan(memory(''));

    expect(FakeClamdStream::$written)->toBe("zINSTREAM\0".pack('N', 0));
});

it('reads a FOUND reply as infected with the signature', function (): void {
    FakeClamdStream::$reply = "stream: Win.Test.EICAR_HDB-1 FOUND\0";

    $result = scanner()->scan(memory('x'));

    expect($result->clean)->toBeFalse()->and($result->signature)->toBe('Win.Test.EICAR_HDB-1');
});

it('parses replies with and without trailing newline or NUL', function (string $reply, bool $clean, ?string $signature): void {
    $result = ClamdScanner::parse($reply);

    expect($result->clean)->toBe($clean)->and($result->signature)->toBe($signature);
})->with([
    'ok' => ['stream: OK', true, null],
    'ok newline' => ["stream: OK\n", true, null],
    'found' => ['stream: Eicar-Signature FOUND', false, 'Eicar-Signature'],
    'found with spaces' => ["stream: Html.Exploit.CVE-2020 FOUND\n", false, 'Html.Exploit.CVE-2020'],
]);

it('treats an ERROR reply as a final refusal', function (): void {
    FakeClamdStream::$reply = "INSTREAM size limit exceeded. ERROR\0";

    expect(fn () => scanner()->scan(memory('x')))->toThrow(ScannerRejected::class, 'INSTREAM size limit exceeded.');
});

it('never reads garbage or silence as clean', function (string $reply): void {
    FakeClamdStream::$reply = $reply;

    expect(fn () => scanner()->scan(memory('x')))->toThrow(ScannerUnavailable::class);
})->with([
    'empty' => [''],
    'nonsense' => ["hello\0"],
    'almost ok' => ["stream: OK but not really\0"],
    'ok for another stream' => ["other: OK\0"],
    'looks clean in the middle' => ["x stream: OK\0"],
]);

it('reports an unreachable scanner and a dropped connection as unavailable', function (): void {
    expect(fn () => scanner(reachable: false)->scan(memory('x')))->toThrow(ScannerUnavailable::class);

    FakeClamdStream::$failWrites = true;
    expect(fn () => scanner()->scan(memory('x')))->toThrow(ScannerUnavailable::class);
});
