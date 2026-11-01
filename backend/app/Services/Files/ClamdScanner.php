<?php

declare(strict_types=1);

namespace App\Services\Files;

use App\Contracts\VirusScanner;
use App\Support\Files\ScannerRejected;
use App\Support\Files\ScannerUnavailable;
use App\Support\Files\ScanResult;
use Closure;

/**
 * ClamAV over clamd's TCP INSTREAM protocol, on plain sockets (no package). Per scan: open a connection, send
 * `zINSTREAM\0`, then the data as chunks of a 4-byte big-endian length plus bytes, then a zero length; clamd answers
 * `stream: OK`, `stream: <Signature> FOUND` or `<reason> ERROR`, NUL-terminated. Anything else, or any I/O failure,
 * is `ScannerUnavailable`: the file stays pending and is never treated as clean.
 */
final class ClamdScanner implements VirusScanner
{
    /** @param Closure(): (resource|false) $connect opens the connection; injectable so the protocol is testable without a daemon */
    public function __construct(private readonly Closure $connect, private readonly int $chunkBytes = 65536) {}

    public static function tcp(string $host, int $port, int $timeoutSeconds, int $chunkBytes = 65536): self
    {
        return new self(function () use ($host, $port, $timeoutSeconds) {
            $socket = @stream_socket_client("tcp://{$host}:{$port}", $errno, $error, $timeoutSeconds);
            if ($socket !== false) {
                stream_set_timeout($socket, $timeoutSeconds);
            }

            return $socket;
        }, $chunkBytes);
    }

    public function scan($stream): ScanResult
    {
        $conn = ($this->connect)();
        if (! is_resource($conn)) {
            throw new ScannerUnavailable('Cannot connect to the virus scanner.');
        }

        try {
            $this->write($conn, "zINSTREAM\0");
            while (! feof($stream)) {
                $chunk = fread($stream, max(1, $this->chunkBytes));
                if ($chunk === false) {
                    throw new ScannerUnavailable('Cannot read the file to scan.');
                }
                if ($chunk === '') {
                    continue;
                }
                $this->write($conn, pack('N', strlen($chunk)).$chunk);
            }
            $this->write($conn, pack('N', 0));

            return self::parse($this->readReply($conn));
        } finally {
            fclose($conn);
        }
    }

    /** Parses a clamd reply (without the terminating NUL or newline). */
    public static function parse(string $reply): ScanResult
    {
        $reply = trim($reply);
        if (preg_match('/^stream: OK$/', $reply) === 1) {
            return ScanResult::clean();
        }
        if (preg_match('/^stream: (.+) FOUND$/', $reply, $m) === 1) {
            return ScanResult::infected(mb_substr($m[1], 0, 200));
        }
        if (preg_match('/^(.*) ERROR$/', $reply, $m) === 1) {
            // "INSTREAM size limit exceeded. ERROR": about this file, final.
            throw new ScannerRejected($m[1] === '' ? 'The scanner refused the file.' : $m[1]);
        }

        throw new ScannerUnavailable('Unreadable answer from the virus scanner.');
    }

    /** @param resource $conn */
    private function write($conn, string $bytes): void
    {
        $length = strlen($bytes);
        for ($sent = 0; $sent < $length;) {
            $n = @fwrite($conn, substr($bytes, $sent));
            if ($n === false || $n === 0) {
                throw new ScannerUnavailable('Lost the connection to the virus scanner.');
            }
            $sent += $n;
        }
    }

    /** @param resource $conn */
    private function readReply($conn): string
    {
        $reply = '';
        while (! feof($conn) && strlen($reply) < 4096) {
            $part = fread($conn, 1024);
            if ($part === false || ($part === '' && stream_get_meta_data($conn)['timed_out'])) {
                break;
            }
            $reply .= $part;
            if (str_contains($reply, "\0")) {
                break;
            }
        }
        if ($reply === '') {
            throw new ScannerUnavailable('No answer from the virus scanner.');
        }

        return rtrim(explode("\0", $reply)[0], "\r\n");
    }
}
