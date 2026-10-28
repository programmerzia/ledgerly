import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLedgerStore } from '@/mock/store';
import { formatMoney } from '@/lib/format';
import {
  ShieldCheck,
  Search,
  Download,
  Printer,
  Calendar,
  Building,
  FileText,
  CheckCircle2,
  ExternalLink,
  Coins,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';

export const WhtCertificatesList: React.FC = () => {
  const navigate = useNavigate();
  const { currentCompany, contacts, settlements, bills } = useLedgerStore();
  const coSlug = currentCompany.slug;

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCert, setSelectedCert] = useState<any | null>(null);

  const suppliersMap = useMemo(() => {
    return new Map(contacts.map((c) => [c.id, c]));
  }, [contacts]);

  // Derive WHT certificates from bills with wht_amount_fc > 0 or settlements
  const certificates = useMemo(() => {
    const certs: any[] = [];
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

    // Default mock entry if none exist
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

  const filteredCerts = useMemo(() => {
    if (!searchQuery) return certificates;
    const q = searchQuery.toLowerCase();
    return certificates.filter(
      (c) =>
        c.cert_number.toLowerCase().includes(q) ||
        c.supplier_name.toLowerCase().includes(q) ||
        c.source_bill_number.toLowerCase().includes(q)
    );
  }, [certificates, searchQuery]);

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-surface-canvas">
      {/* Top Header */}
      <div className="h-12 border-b border-line-border px-4 flex items-center justify-between shrink-0 bg-surface-elevated">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-brand-teal" />
            <h1 className="text-sm font-bold text-ink-900">Withholding Tax (WHT) Certificates</h1>
            <span className="text-[11px] text-ink-muted">Official Supplier Tax Deduction Records</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-ink-muted absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search certificates, vendors..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 pl-8 pr-3 text-xs rounded-sm border border-line-border bg-surface-subtle focus:bg-surface-elevated focus:outline-none focus:border-brand-teal w-60"
            />
          </div>

          <button
            type="button"
            onClick={() => window.print()}
            className="flex items-center gap-1.5 h-8 px-3 rounded-sm border border-line-border bg-surface-subtle hover:bg-surface-neutral text-ink-900 text-xs font-medium transition"
          >
            <Printer className="w-3.5 h-3.5 text-ink-muted" />
            <span>Print Batch</span>
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="p-4 flex flex-col gap-4 overflow-y-auto">
        <div className="border border-line-border rounded-md overflow-hidden bg-surface-elevated shadow-2xs">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="h-9 bg-surface-neutral border-b border-line-border text-[11px] font-semibold text-ink-muted uppercase tracking-wider">
                <th className="px-3">Certificate #</th>
                <th className="px-3">Supplier Name</th>
                <th className="px-3">Tax Identification (TIN)</th>
                <th className="px-3">Issue Date</th>
                <th className="px-3">Source Bill</th>
                <th className="px-3 text-right">Gross Contract</th>
                <th className="px-3 text-right">WHT Rate</th>
                <th className="px-3 text-right">Tax Withheld</th>
                <th className="px-3 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-border">
              {filteredCerts.map((cert) => (
                <tr
                  key={cert.id}
                  onClick={() => setSelectedCert(cert)}
                  className="h-9 hover:bg-surface-neutral cursor-pointer transition"
                >
                  <td className="px-3 font-mono font-medium text-brand-teal">
                    {cert.cert_number}
                  </td>
                  <td className="px-3 font-medium text-ink-900">
                    {cert.supplier_name}
                  </td>
                  <td className="px-3 font-mono text-[11px] text-ink-muted">
                    {cert.supplier_tax_id}
                  </td>
                  <td className="px-3 font-mono text-[11px] text-ink-muted">
                    {cert.issue_date}
                  </td>
                  <td className="px-3 font-mono text-[11px] text-ink-muted">
                    {cert.source_bill_number}
                  </td>
                  <td className="px-3 text-right font-mono text-num text-ink-900">
                    {formatMoney(cert.gross_amount)}
                  </td>
                  <td className="px-3 text-right font-mono text-num text-ink-muted">
                    {cert.wht_rate_pct}%
                  </td>
                  <td className="px-3 text-right font-mono text-num font-semibold text-danger">
                    {formatMoney(cert.wht_amount)}
                  </td>
                  <td className="px-3 text-center">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedCert(cert);
                      }}
                      className="p-1 text-ink-muted hover:text-brand-teal rounded transition"
                      title="View Certificate"
                    >
                      <FileText className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="text-[11px] text-ink-muted px-1 flex items-center justify-between">
          <span>Showing {filteredCerts.length} certificates</span>
          <span>Compliant with Ministry of Finance Withholding Tax Regulations</span>
        </div>
      </div>

      {/* Certificate Preview Modal */}
      <Dialog open={!!selectedCert} onOpenChange={(open) => !open && setSelectedCert(null)}>
        <DialogContent className="max-w-[540px] p-6">
          {selectedCert && (
            <div className="flex flex-col gap-4">
              <DialogHeader>
                <div className="flex items-center justify-between">
                  <DialogTitle className="flex items-center gap-2 text-sm font-bold text-text-primary">
                    <ShieldCheck className="w-5 h-5 text-accent" />
                    <span>Tax Withholding Certificate</span>
                  </DialogTitle>
                  <span className="font-mono text-xs font-semibold text-accent">
                    {selectedCert.cert_number}
                  </span>
                </div>
              </DialogHeader>

              <div className="p-4 bg-surface-neutral border border-border rounded-md flex flex-col gap-3 text-xs">
                <div className="text-center pb-2 border-b border-border">
                  <div className="font-bold text-text-primary text-sm">{currentCompany.legal_name}</div>
                  <div className="text-[11px] text-text-muted">Taxpayer Identification Number: {currentCompany.tax_id}</div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div>
                    <span className="text-text-muted block">Withholding Agent</span>
                    <span className="font-medium text-text-primary">{currentCompany.name}</span>
                  </div>
                  <div>
                    <span className="text-text-muted block">Payee / Supplier</span>
                    <span className="font-medium text-text-primary">{selectedCert.supplier_name}</span>
                  </div>
                  <div>
                    <span className="text-text-muted block">Payee Tax ID (TIN)</span>
                    <span className="font-mono text-text-primary">{selectedCert.supplier_tax_id}</span>
                  </div>
                  <div>
                    <span className="text-text-muted block">Tax Period</span>
                    <span className="font-medium text-text-primary">{selectedCert.period}</span>
                  </div>
                </div>

                <div className="p-3 bg-surface rounded border border-border flex flex-col gap-1.5 font-mono text-xs">
                  <div className="flex justify-between text-text-muted">
                    <span>Gross Contract / Service Amount:</span>
                    <span className="text-text-primary font-semibold">{formatMoney(selectedCert.gross_amount)}</span>
                  </div>
                  <div className="flex justify-between text-text-muted">
                    <span>Withholding Tax Rate:</span>
                    <span className="text-text-primary font-semibold">{selectedCert.wht_rate_pct}%</span>
                  </div>
                  <div className="flex justify-between text-danger font-bold pt-1 border-t border-border">
                    <span>Tax Withheld & Remitted:</span>
                    <span>{formatMoney(selectedCert.wht_amount)}</span>
                  </div>
                </div>
              </div>

              <DialogFooter className="gap-2 pt-2 border-t border-border">
                <button
                  type="button"
                  onClick={() => setSelectedCert(null)}
                  className="h-8 px-3 rounded-sm border border-border bg-surface text-text-primary text-xs font-medium hover:bg-surface-neutral transition"
                >
                  Close
                </button>

                <button
                  type="button"
                  onClick={() => {
                    window.print();
                    setSelectedCert(null);
                  }}
                  className="h-8 px-4 rounded-sm bg-accent text-white text-xs font-semibold hover:bg-accent-hover transition flex items-center gap-1.5 shadow-xs"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Print Certificate</span>
                </button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};
