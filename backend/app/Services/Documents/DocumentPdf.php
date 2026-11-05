<?php

declare(strict_types=1);

namespace App\Services\Documents;

use App\Contracts\HtmlToPdf;
use App\Models\Organisation\Company;

/**
 * Renders one document to PDF inside the current tenant context: data from {@see DocumentData}, Blade template from
 * `resources/views/pdf`, Chromium through {@see HtmlToPdf}. Call it from a queued job, never from a web request.
 */
final class DocumentPdf
{
    public function __construct(private readonly DocumentData $data, private readonly HtmlToPdf $engine) {}

    /**
     * @param  array<string, mixed>  $params
     * @return array{pdf: string, filename: string}
     */
    public function render(string $type, Company $company, string $id, array $params = []): array
    {
        $built = $this->data->build($type, $company, $id, $params);
        $html = view($built['view'], $built['data'])->render();
        $footer = (string) $built['data']['footer'];

        return ['pdf' => $this->engine->pdf($html, $this->footerTemplate($footer)), 'filename' => $built['filename']];
    }

    /**
     * The HTML only, for tests and for checking a template without a browser.
     *
     * @param  array<string, mixed>  $params
     */
    public function html(string $type, Company $company, string $id, array $params = []): string
    {
        $built = $this->data->build($type, $company, $id, $params);

        return view($built['view'], $built['data'])->render();
    }

    private function footerTemplate(string $footer): string
    {
        return '<div style="width:100%;font-size:8px;color:#6b7280;padding:0 14mm;display:flex;justify-content:space-between;font-family:Helvetica,Arial,sans-serif">'
            .'<span>'.e($footer).'</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>';
    }
}
