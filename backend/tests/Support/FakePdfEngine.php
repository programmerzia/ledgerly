<?php

declare(strict_types=1);

namespace Tests\Support;

use App\Contracts\HtmlToPdf;

/** Stands in for Chromium: keeps the HTML it was given and returns a recognisable PDF-looking payload. */
final class FakePdfEngine implements HtmlToPdf
{
    /** @var list<string> */
    public array $html = [];

    public ?\Throwable $fail = null;

    public function pdf(string $html, string $footerHtml = ''): string
    {
        if ($this->fail !== null) {
            throw $this->fail;
        }
        $this->html[] = $html;

        return "%PDF-1.4\n% fake pdf for tests\n".md5($html)."\n%%EOF";
    }

    public function last(): string
    {
        return $this->html[array_key_last($this->html)] ?? '';
    }
}
