<?php

declare(strict_types=1);

namespace App\Support\Files;

use RuntimeException;

/** The scanner answered with an error for this file (for example "size limit exceeded"). Retrying will not help. */
final class ScannerRejected extends RuntimeException {}
