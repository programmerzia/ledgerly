<?php

declare(strict_types=1);

namespace App\Contracts;

/** Turns finished HTML into PDF bytes. The real one drives headless Chromium on a worker; tests bind a fake. */
interface HtmlToPdf
{
    /** @param string $footerHtml the page footer (Chromium template: `.pageNumber` and `.totalPages` spans are filled in) */
    public function pdf(string $html, string $footerHtml = ''): string;
}
