<?php

declare(strict_types=1);

return [
    // Plan 3c.4 / 3c.5: document PDFs and emails are limited per company, per hour.
    'pdfs_per_hour' => (int) env('DOCUMENT_PDFS_PER_HOUR', 120),
    'emails_per_hour' => (int) env('DOCUMENT_EMAILS_PER_HOUR', 60),

    // Most recipients on one send, and the largest PDF the mail will carry (bytes).
    'max_recipients' => 5,
    'max_attachment_bytes' => 10 * 1024 * 1024,
];
