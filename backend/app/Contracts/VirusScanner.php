<?php

declare(strict_types=1);

namespace App\Contracts;

use App\Support\Files\ScannerRejected;
use App\Support\Files\ScannerUnavailable;
use App\Support\Files\ScanResult;

/** Scans a byte stream for malware (13 §17). Content is never served on any answer other than `clean`. */
interface VirusScanner
{
    /**
     * @param  resource  $stream  readable, positioned at the start
     *
     * @throws ScannerUnavailable the scanner could not be reached or answered garbage: try again later, never treat as clean
     * @throws ScannerRejected the scanner refused the file (for example its size limit): final
     */
    public function scan($stream): ScanResult;
}
