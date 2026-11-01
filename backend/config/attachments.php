<?php

declare(strict_types=1);

/*
 * Attachments (13 §17, plan 2.17). Files are never public: uploads land under a random key in the
 * quarantine zone, a scan job promotes them to the clean zone, and downloads are short-lived signed URLs.
 */
return [
    /* The filesystem disk (config/filesystems.php). `attachments` is a private local disk; point this at an
     * S3/MinIO disk once league/flysystem-aws-s3-v3 is approved and an S3 AttachmentStore exists (ADR needed). */
    'disk' => env('ATTACHMENTS_DISK', 'attachments'),

    /* 04 §4 and 13 §17: 25 MB. */
    'max_bytes' => (int) env('ATTACHMENTS_MAX_BYTES', 25 * 1024 * 1024),

    /* Allowed content types. The type is sniffed from the bytes on the server; the client's claim is only a hint. */
    'mimes' => [
        'application/pdf',
        'image/png', 'image/jpeg', 'image/gif', 'image/webp',
        'text/plain', 'text/csv',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ],

    /* Minutes a presigned upload target stays valid, and seconds a download URL does (04 §4: 5 minutes). */
    'upload_ttl_minutes' => 15,
    'download_ttl_seconds' => 300,

    /* ClamAV daemon, clamd TCP INSTREAM (docker compose service `clamav`). */
    'clamav' => [
        'host' => env('CLAMAV_HOST', '127.0.0.1'),
        'port' => (int) env('CLAMAV_PORT', 3310),
        'timeout' => (int) env('CLAMAV_TIMEOUT', 30),
        'chunk_bytes' => 65536,
    ],
];
