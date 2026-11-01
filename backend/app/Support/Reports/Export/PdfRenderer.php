<?php

declare(strict_types=1);

namespace App\Support\Reports\Export;

use Illuminate\Support\Facades\View;
use Spatie\Browsershot\Browsershot;

/**
 * PDF through headless Chromium (Browsershot; no external PDF service, 04_TRD §2). The HTML is rendered
 * from `resources/views/reports/table.blade.php` and can be tested without a browser; turning it into a PDF
 * needs Chromium and the `puppeteer` node module on the worker (`reports.chromium_path`).
 */
class PdfRenderer
{
    public function html(ReportTable $table): string
    {
        return View::make('reports.table', ['table' => $table])->render();
    }

    public function pdf(ReportTable $table): string
    {
        $shot = Browsershot::html($this->html($table))->format('A4')->margins(14, 12, 14, 12)->noSandbox()->showBackground();
        $chrome = config('reports.chromium_path');
        if (is_string($chrome) && $chrome !== '') {
            $shot->setChromePath($chrome);
        }

        return $shot->pdf();
    }
}
