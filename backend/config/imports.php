<?php

declare(strict_types=1);

/*
 * Data imports (plan 2.18). The upload is parsed in the request and only its rows are kept (13 §15: apply runs on the `imports` queue).
 * The caps keep a request and the rows table bounded; a larger file is refused with 413/422, never half-read.
 */
return [
    /* Largest upload, in bytes (CSV or XLSX). */
    'max_bytes' => (int) env('IMPORTS_MAX_BYTES', 5 * 1024 * 1024),

    /* Most data rows (header excluded) and columns in one file. */
    'max_rows' => (int) env('IMPORTS_MAX_ROWS', 5000),
    'max_columns' => (int) env('IMPORTS_MAX_COLUMNS', 60),

    /* A cell longer than this is refused, not truncated. */
    'max_cell_length' => 2000,

    /* Queue for the apply job (13 §15 Horizon queues). */
    'queue' => 'imports',
];
