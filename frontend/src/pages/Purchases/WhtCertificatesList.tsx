import React, { useState, useMemo } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { useLedgerStore } from '@/mock/store';
import { DataTable } from '@/components/domain/DataTable';
import { formatMoney } from '@/lib/format';
import { ShieldCheck, Printer, Eye, ExternalLink } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { PageHeader } from '@/components/domain/PageHeader';

interface WhtCert {
  id: string;
  cert_number: string;
  issue_date: string;
  period: string;
  supplier_name: string;
  supplier_tax_id: string;
  gross_amount: number;
  wht_rate_pct: number;
  wht_amount: number;
  currency: string;
  source_bill_number: string;
  status: string;
}

export const WhtCertificatesList: React.FC = () => {
  const { currentCompany, contacts, bills, uiDensity } = useLedgerStore();
  const navigate = useNavigate();
  const [selectedCert, setSelectedCert] = useState<WhtCert | null>(null);

  const suppliersMap = useMemo(() => {
    return new Map(contacts.map((c) => [c.id, c]));
  }, [contacts]);

  // Derive WHT certificates from bills with wht_amount_fc > 0
  const certificates = useMemo<WhtCert[]>(() => {
    const certs: WhtCert[] = [];
    let count = 1;

    for (const b of bills) {
      if (b.wht_amount_fc && b.wht_amount_fc > 0) {
        const supplier = suppliersMap.get(b.contact_id);
        certs.push({
          id: `wht-cert-${b.id}`,
          cert_number: `WHT-2026-${String(count++).padStart(4, '0')}`,
          issue_date: b.issue_date,
          period: 'October 2026',
          supplier_name: supplier?.name || b.contact_id,
          supplier_tax_id: supplier?.tax_id || 'SO-TIN-882914',
          gross_amount: b.total,
          wht_rate_pct: 5,
          wht_amount: b.wht_amount_fc,
          currency: b.currency,
          source_bill_number: b.number || 'BIL-DRAFT',
          status: 'issued',
        });
      }
    }

    if (certs.length === 0) {
      certs.push({
        id: 'wht-cert-sample',
        cert_number: 'WHT-2026-0001',
        issue_date: '2026-10-20',
        period: 'October 2026',
        supplier_name: 'Dahabshiil Business Services',
        supplier_tax_id: 'SO-TIN-908122',
        gross_amount: 450000,
        wht_rate_pct: 5,
        wht_amount: 22500,
        currency: 'USD',
        source_bill_number: 'BIL-2026-0012',
        status: 'issued',
      });
    }

    return certs;
  }, [bills, suppliersMap]);

  const columns: ColumnDef<WhtCert>[] = [
    {
      accessorKey: 'cert_number',
      header: 'Certificate #',
      cell: ({ row }) => (
        <span
          onClick={() => setSelectedCert(row.original)}
          className="font-mono font-medium text-accent hover:underline cursor-pointer"
        >
          {row.original.cert_number}
        </span>
      ),
    },
    {
      accessorKey: 'supplier_name',
      header: 'Supplier / Payee',
      cell: ({ row }) => (
        <span className="font-medium text-text-primary">{row.original.supplier_name}</span>
      ),
    },
    {
      accessorKey: 'supplier_tax_id',
      header: 'Supplier TIN',
      cell: ({ row }) => (
        <span className="font-mono text-text-muted text-[11px]">{row.original.supplier_tax_id}</span>
      ),
    },
    {
      accessorKey: 'issue_date',
      header: 'Date',
      cell: ({ row }) => (
        <span className="font-mono text-text-muted text-[11px]">{row.original.issue_date}</span>
      ),
    },
    {
      accessorKey: 'source_bill_number',
      header: 'Source Bill',
      cell: ({ row }) => (
        <span className="font-mono text-text-muted text-[11px]">{row.original.source_bill_number}</span>
      ),
    },
    {
      accessorKey: 'gross_amount',
      header: () => <div className="text-right">Gross amount</div>,
      cell: ({ row }) => (
        <div className="text-right font-mono text-num text-text-primary">
          {formatMoney(row.original.gross_amount, row.original.currency)}
        </div>
      ),
    },
    {
      accessorKey: 'wht_rate_pct',
      header: () => <div className="text-right">Rate</div>,
      cell: ({ row }) => (
        <div className="text-right font-mono text-num text-text-muted">
          {row.original.wht_rate_pct}%
        </div>
      ),
    },
    {
      accessorKey: 'wht_amount',
      header: () => <div className="text-right">WHT Withheld</div>,
      cell: ({ row }) => (
        <div className="text-right font-mono text-num font-semibold text-danger">
          {formatMoney(row.original.wht_amount, row.original.currency)}
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Withholding tax certificates"
        subtitle="Proof of tax held back from supplier payments"
        actions={
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 h-8 px-3 border border-border hover:border-border-strong bg-surface hover:bg-surface-neutral text-text-primary rounded-md text-[13px] font-medium transition"
          >
            <Printer className="size-4 text-text-muted" />
            <span>Print all</span>
          </button>
        }
      />

      <DataTable
        columns={columns}
        data={certificates}
        searchPlaceholder="Filter certificates by number, supplier, or bill..."
        rowDensity={uiDensity}
        contextMenuTitle={(r) => r.cert_number}
        rowActions={(r) => {
          const bill = bills.find((b) => (b.number || b.reference) === r.source_bill_number);
          return [
            { label: 'View certificate', icon: Eye, shortcut: 'Enter', onClick: () => setSelectedCert(r) },
            { label: 'Print', icon: Printer, onClick: () => { setSelectedCert(r); setTimeout(() => window.print(), 200); } },
            {
              label: 'Open source bill',
              icon: ExternalLink,
              disabled: !bill,
              disabledReason: 'The original bill could not be found',
              onClick: () => bill && navigate(`/${currentCompany.slug}/bills/${bill.id}`),
            },
          ];
        }}
        onRowClick={(row) => setSelectedCert(row)}
        onRowDoubleClick={(row) => setSelectedCert(row)}
      />

      {/* Certificate Preview Modal */}
      <Dialog open={!!selectedCert} onOpenChange={(open) => !open && setSelectedCert(null)}>
        <DialogContent className="p-6">
          {selectedCert && (
            <div className="flex flex-col gap-4">
              <DialogHeader>
                <div className="flex items-center justify-between">
                  <DialogTitle className="flex items-center gap-2 text-sm font-semibold text-text-primary">
                    <ShieldCheck className="w-5 h-5 text-accent" />
                    <span>Withholding tax certificate</span>
                  </DialogTitle>
                  <span className="font-mono text-xs font-semibold text-accent">
                    {selectedCert.cert_number}
                  </span>
                </div>
              </DialogHeader>

              <div className="p-4 bg-surface-neutral/60 border border-border rounded-md flex flex-col gap-3 text-xs">
                <div className="text-center pb-2 border-b border-border">
                  <div className="font-semibold text-text-primary text-sm">{currentCompany.legal_name}</div>
                  <div className="text-[11px] text-text-muted">Tax ID: {currentCompany.tax_id}</div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div>
                    <span className="text-text-muted block">Withholding agent</span>
                    <span className="font-medium text-text-primary">{currentCompany.name}</span>
                  </div>
                  <div>
                    <span className="text-text-muted block">Payee / Supplier</span>
                    <span className="font-medium text-text-primary">{selectedCert.supplier_name}</span>
                  </div>
                  <div>
                    <span className="text-text-muted block">Payee tax ID</span>
                    <span className="font-mono text-text-primary">{selectedCert.supplier_tax_id}</span>
                  </div>
                  <div>
                    <span className="text-text-muted block">Tax period</span>
                    <span className="font-medium text-text-primary">{selectedCert.period}</span>
                  </div>
                </div>

                <div className="p-3 bg-surface rounded border border-border flex flex-col gap-1.5 font-mono text-xs">
                  <div className="flex justify-between text-text-muted">
                    <span>Gross contract or service amount:</span>
                    <span className="text-text-primary font-semibold">{formatMoney(selectedCert.gross_amount, selectedCert.currency)}</span>
                  </div>
                  <div className="flex justify-between text-text-muted">
                    <span>Withholding tax rate:</span>
                    <span className="text-text-primary font-semibold">{selectedCert.wht_rate_pct}%</span>
                  </div>
                  <div className="flex justify-between text-danger font-semibold pt-1 border-t border-border">
                    <span>Tax withheld:</span>
                    <span>{formatMoney(selectedCert.wht_amount, selectedCert.currency)}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
                <button
                  type="button"
                  onClick={() => setSelectedCert(null)}
                  className="h-8 px-3 rounded border border-border text-xs text-text-muted hover:text-text-primary hover:bg-surface-neutral transition"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="h-8 px-3 bg-accent hover:bg-accent-hover text-white rounded text-[13px] font-medium flex items-center gap-1.5 transition"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Print certificate</span>
                </button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};
