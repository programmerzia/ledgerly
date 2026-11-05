/**
 * Download PDF on a live document (3c.4). The server owns the rules: a PDF is made on a worker from the stored document,
 * and who may read it is who may view the document. This shows the server's verdict in plain words.
 */
import React from 'react';
import { FileDown, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { BTN_SECONDARY } from '@/pages/Sales/invoice-view/shared';
import { describeError } from '@/api/messages';
import type { DocFamily, StatementParams } from '@/api/adapters/documents';
import { usePdfDownload } from '@/data/documents';
import { cn } from '@/lib/utils';

/** "Download PDF". For a statement pass the period. */
export const PdfButton: React.FC<{ family: DocFamily; id: string; params?: StatementParams; label?: string; disabled?: boolean }> = ({ family, id, params, label = 'Download PDF', disabled }) => {
  const pdf = usePdfDownload(family, id);
  return (
    <button
      type="button"
      disabled={pdf.busy || disabled}
      className={cn(BTN_SECONDARY, 'disabled:opacity-60')}
      onClick={() => void pdf.run(params).catch((e: unknown) => toast.error(describeError(e)))}
    >
      {pdf.busy ? <Loader2 className="size-4 animate-spin text-text-muted" /> : <FileDown className="size-4 text-text-muted" />}
      {pdf.busy ? 'Preparing PDF…' : label}
    </button>
  );
};
