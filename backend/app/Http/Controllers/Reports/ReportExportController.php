<?php

declare(strict_types=1);

namespace App\Http\Controllers\Reports;

use App\Http\Controllers\Controller;
use App\Http\Requests\Reports\ReportRequest;
use App\Http\Support\RequestActor;
use App\Jobs\Reports\RunReportExport;
use App\Models\Organisation\Company;
use App\Services\Reports\ExportStore;
use App\Services\Reports\ReportExport;
use App\Support\Audit\DetachedAudit;
use App\Support\Reports\Report;
use App\Support\Tenancy\TenantContext;
use Illuminate\Http\Request;
use Illuminate\Routing\Attributes\Controllers\Authorize;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\Response;

/**
 * Report exports (13 §13, §16): XLSX and CSV streamed, PDF through Chromium. Small exports stream in the
 * response; one over `reports.export_inline_max_rows` rows is queued and fetched when ready. Every export,
 * inline or queued, is audited when it is requested (a read has no transaction to ride on, so the event
 * goes through DetachedAudit), and exports are limited to 10 an hour per company (the `report-exports`
 * limiter). ADR-0004 asks for a signing PIN on the audit-log export; report exports do not need one.
 */
final class ReportExportController extends Controller
{
    #[Authorize('export', Report::class)]
    public function export(ReportRequest $request, Company $company, string $report, ReportExport $exports, ExportStore $store, DetachedAudit $audit, TenantContext $tenant): Response
    {
        $input = $request->validated();
        $format = (string) ($input['format'] ?? '');
        if (! isset(ReportExport::FORMATS[$format])) {
            throw ValidationException::withMessages(['format' => ['Choose xlsx, csv or pdf.']]);
        }
        unset($input['format']);

        $plan = $exports->plan($report, $company, $input);
        $queued = $plan['rows'] > (int) config('reports.export_inline_max_rows');
        $audit->record(RequestActor::from($request, $company->id), 'report.exported', null, [
            'report' => $report, 'format' => $format, 'rows' => $plan['rows'], 'delivery' => $queued ? 'queued' : 'inline', 'parameters' => $input,
        ]);

        if ($queued) {
            $id = (string) Str::uuid7();
            $principal = call_user_func($request->getUserResolver());
            $owner = is_object($principal) && method_exists($principal, 'getAuthIdentifier') ? (string) $principal->getAuthIdentifier() : null;
            $store->queued($tenant->require(), $company->id, $id, $owner, $report, $format);
            RunReportExport::dispatch($tenant->require(), $company->id, $id, $report, $format, $input);

            return response()->json(['data' => ['id' => $id, 'status' => 'queued', 'report' => $report, 'format' => $format]], 202);
        }

        $filename = $this->filename($report, $company, $format);
        $headers = ['Content-Type' => ReportExport::FORMATS[$format], 'X-Content-Type-Options' => 'nosniff'];
        if ($format === 'pdf') {
            return response()->streamDownload(function () use ($exports, $plan): void {
                $tmp = tempnam(sys_get_temp_dir(), 'report-pdf-');
                if ($tmp === false) {
                    throw new \RuntimeException('No temporary file for the export.');
                }
                try {
                    $exports->write($plan['table'], 'pdf', $tmp);
                    readfile($tmp);
                } finally {
                    @unlink($tmp);
                }
            }, $filename, $headers);
        }

        return response()->streamDownload(function () use ($exports, $plan, $format): void {
            $exports->write($plan['table'], $format, 'php://output');
        }, $filename, $headers);
    }

    /** Status of a queued export; the file itself once it is ready. */
    #[Authorize('export', Report::class)]
    public function show(Request $request, Company $company, string $exportId, ExportStore $store, TenantContext $tenant): Response
    {
        $record = $store->find($tenant->require(), $company->id, $exportId);
        $principal = call_user_func($request->getUserResolver());
        $me = is_object($principal) && method_exists($principal, 'getAuthIdentifier') ? (string) $principal->getAuthIdentifier() : null;
        if ($record === null || ($record['owner'] ?? null) !== $me) {
            abort(404);
        }
        if (($record['status'] ?? '') !== 'ready') {
            return response()->json(['data' => ['id' => $exportId, 'status' => $record['status'] ?? 'queued']]);
        }

        $path = (string) $record['path'];
        $format = (string) $record['format'];
        $disk = $store->disk();

        return response()->streamDownload(function () use ($disk, $path): void {
            $stream = $disk->readStream($path);
            if (is_resource($stream)) {
                fpassthru($stream);
                fclose($stream);
            }
        }, $this->filename((string) $record['report'], $company, $format), ['Content-Type' => ReportExport::FORMATS[$format] ?? 'application/octet-stream', 'X-Content-Type-Options' => 'nosniff']);
    }

    private function filename(string $report, Company $company, string $format): string
    {
        return $report.'-'.Str::slug($company->name).'-'.gmdate('Ymd').'.'.$format;
    }
}
