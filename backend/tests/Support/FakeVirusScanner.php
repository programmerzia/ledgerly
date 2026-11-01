<?php

declare(strict_types=1);

namespace Tests\Support;

use App\Contracts\VirusScanner;
use App\Support\Files\ScannerRejected;
use App\Support\Files\ScannerUnavailable;
use App\Support\Files\ScanResult;

/** Test scanner: clean unless told otherwise; records what it was asked to scan. */
final class FakeVirusScanner implements VirusScanner
{
    public ?string $signature = null;

    public bool $down = false;

    public ?string $refuse = null;

    /** @var list<string> */
    public array $scanned = [];

    public function scan($stream): ScanResult
    {
        if ($this->down) {
            throw new ScannerUnavailable('down');
        }
        $this->scanned[] = (string) stream_get_contents($stream);
        if ($this->refuse !== null) {
            throw new ScannerRejected($this->refuse);
        }

        return $this->signature === null ? ScanResult::clean() : ScanResult::infected($this->signature);
    }
}
