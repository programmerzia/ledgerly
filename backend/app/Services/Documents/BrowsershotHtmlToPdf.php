<?php

declare(strict_types=1);

namespace App\Services\Documents;

use App\Contracts\HtmlToPdf;
use Spatie\Browsershot\Browsershot;

/**
 * Headless Chromium through Browsershot, the same engine as the report PDFs (04_TRD §2). Needs node, the `puppeteer`
 * module and a Chromium binary (`reports.chromium_path`) on the machine that runs it: the `exports` worker, never a web process.
 */
final class BrowsershotHtmlToPdf implements HtmlToPdf
{
    public function pdf(string $html, string $footerHtml = ''): string
    {
        $shot = Browsershot::html($html)->format('A4')->margins(14, 14, 18, 14)->noSandbox()->showBackground()->timeout(60);
        if ($footerHtml !== '') {
            $shot->showBrowserHeaderAndFooter()->hideHeader()->footerHtml($footerHtml);
        }
        $chrome = config('reports.chromium_path');
        if (is_string($chrome) && $chrome !== '') {
            $shot->setChromePath($chrome);
        }

        $modules = config('reports.node_module_path');
        if (is_string($modules) && $modules !== '') {
            $shot->setNodeModulePath($modules);
        }

        return $shot->pdf();
    }
}
