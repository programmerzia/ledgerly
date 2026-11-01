<?php

declare(strict_types=1);

namespace App\Support\Files;

use RuntimeException;

/** The scanner is down, timed out or answered something unreadable. Transient: the file stays pending. */
final class ScannerUnavailable extends RuntimeException {}
