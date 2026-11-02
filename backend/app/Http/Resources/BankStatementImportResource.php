<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Services\Banking\StatementImportResult;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The outcome of a statement import. `statement` is null when the file added nothing; `duplicate_lines_skipped` counts lines that were
 * already imported (importing the same file twice adds nothing); `warnings` such as statement_balance_mismatch, balances_not_provided.
 *
 * @mixin StatementImportResult
 */
final class BankStatementImportResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'statement' => $this->statement === null ? null : new BankStatementResource($this->statement),
            'lines_imported' => $this->linesImported,
            'duplicate_lines_skipped' => $this->duplicateLinesSkipped,
            'already_imported' => $this->alreadyImported,
            /** @var list<string> */
            'warnings' => $this->warnings,
        ];
    }
}
