import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLedgerStore } from '@/mock/store';
import { Upload, CheckCircle2, AlertCircle, ArrowLeft, ChevronRight, ShieldCheck, RefreshCw, FileCheck } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/domain/PageHeader';
import { WizardStepper } from '@/pages/Onboarding/WizardStepper';

type ImportEntity = 'customers' | 'accounts' | 'opening_balances' | 'bank_lines';

interface MappedField {
  ledgerField: string;
  label: string;
  required: boolean;
  csvColumn: string;
}

interface ValidationRow {
  rowNum: number;
  data: Record<string, string>;
  status: 'valid' | 'error';
  errorMessage?: string;
}

export const ImportWizard: React.FC = () => {
  const navigate = useNavigate();
  const { currentCompany, addAccount, contacts } = useLedgerStore();
  const coSlug = currentCompany.slug;

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [selectedEntity, setSelectedEntity] = useState<ImportEntity>('customers');
  const [fileName, setFileName] = useState<string>('customers_import_oct2026.csv');
  const [dragging, setDragging] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [appliedCount, setAppliedCount] = useState(0);

  // Field mappings state
  const [mappings, setMappings] = useState<MappedField[]>([
    { ledgerField: 'name', label: 'Customer name', required: true, csvColumn: 'Company Name' },
    { ledgerField: 'code', label: 'Customer code', required: true, csvColumn: 'Cust ID' },
    { ledgerField: 'email', label: 'Billing email', required: false, csvColumn: 'Email' },
    { ledgerField: 'tax_id', label: 'Tax ID', required: false, csvColumn: 'Tax Number' },
    { ledgerField: 'payment_terms', label: 'Payment terms (days)', required: false, csvColumn: 'Terms' },
  ]);

  // Mock parsed rows
  const [parsedRows, setParsedRows] = useState<ValidationRow[]>([
    {
      rowNum: 1,
      data: { 'Company Name': 'Dahabshiil Telecom Inc', 'Cust ID': 'CUST-009', 'Email': 'billing@dahabshiil.so', 'Tax Number': 'SO-9821-X', 'Terms': '30' },
      status: 'valid',
    },
    {
      rowNum: 2,
      data: { 'Company Name': 'Telesom Somaliland Ltd', 'Cust ID': 'CUST-010', 'Email': 'accounts@telesom.com', 'Tax Number': 'SL-4810-T', 'Terms': '15' },
      status: 'valid',
    },
    {
      rowNum: 3,
      data: { 'Company Name': '', 'Cust ID': 'CUST-011', 'Email': 'info@unnamed.org', 'Tax Number': '', 'Terms': '30' },
      status: 'error',
      errorMessage: 'Customer name is blank',
    },
    {
      rowNum: 4,
      data: { 'Company Name': 'Golis Telecom Puntland', 'Cust ID': 'CUST-012', 'Email': 'finance@golis.net', 'Tax Number': 'PL-3920-G', 'Terms': '30' },
      status: 'valid',
    },
    {
      rowNum: 5,
      data: { 'Company Name': 'Somlink Logistics Hub', 'Cust ID': 'CUST-013', 'Email': 'invoices@somlink.so', 'Tax Number': 'SO-1192-S', 'Terms': '45' },
      status: 'valid',
    },
  ]);

  const validRows = parsedRows.filter((r) => r.status === 'valid');
  const errorRows = parsedRows.filter((r) => r.status === 'error');

  const handleApplyImport = () => {
    setIsApplying(true);
    setTimeout(() => {
      setIsApplying(false);
      setAppliedCount(validRows.length);
      setStep(4);
      toast.success(`Imported ${validRows.length} ${selectedEntity} successfully.`);
    }, 800);
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-y-auto bg-surface-canvas p-6">
      <div className="max-w-4xl mx-auto w-full flex flex-col gap-6">
        <PageHeader
          breadcrumb={[{ label: 'Settings', to: `/${coSlug}/settings` }, { label: 'Import data' }]}
          title="Import data"
          subtitle="Bring in customers, accounts or bank lines from a spreadsheet. Nothing is saved until you confirm."
          actions={
            <button
              type="button"
              onClick={() => navigate(`/${coSlug}/settings`)}
              className="flex items-center gap-1.5 h-8 px-3 rounded-md border border-border bg-surface hover:bg-surface-neutral text-[13px] font-medium text-text-primary cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to settings</span>
            </button>
          }
        />

        <div className="rounded-lg border border-border bg-surface px-6 pb-4 pt-5">
          <WizardStepper
            steps={[{ title: 'Choose file' }, { title: 'Match columns' }, { title: 'Check data' }, { title: 'Done' }]}
            current={step}
            onSelect={(n) => step < 4 && setStep(n as 1 | 2 | 3 | 4)}
          />
        </div>

        {/* STEP 1: SELECT ENTITY & FILE */}
        {step === 1 && (
          <div className="bg-surface border border-border rounded-lg p-7 flex flex-col gap-6">
            <div>
              <h2 className="text-sm font-semibold text-text-primary mb-1">What do you want to import?</h2>
              <p className="text-[13px] text-text-muted">Choose the kind of data to add to {currentCompany.name}:</p>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              {[
                { id: 'customers', title: 'Customers', desc: 'Names, emails, tax IDs and payment terms' },
                { id: 'accounts', title: 'Chart of accounts', desc: 'Account codes, names and types' },
                { id: 'opening_balances', title: 'Opening balances', desc: 'Your starting balances, as one journal' },
                { id: 'bank_lines', title: 'Bank statement lines', desc: 'Transactions to match against your books' },
              ].map((ent) => {
                const isSel = selectedEntity === ent.id;
                return (
                  <div
                    key={ent.id}
                    onClick={() => setSelectedEntity(ent.id as ImportEntity)}
                    className={`p-4 rounded-lg border cursor-pointer transition flex items-start gap-3 ${
                      isSel ? 'border-accent bg-surface-neutral text-text-primary' : 'border-border bg-surface hover:border-border-strong'
                    }`}
                  >
                    <div>
                      <div className="text-[13px] font-semibold text-text-primary">{ent.title}</div>
                      <div className="text-xs text-text-muted mt-0.5">{ent.desc}</div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* File drop zone */}
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const f = e.dataTransfer.files?.[0];
                if (f) { setFileName(f.name); toast.success(`${f.name} added`); }
              }}
              className={`border-2 border-dashed rounded-lg p-8 flex flex-col items-center justify-center gap-3 transition ${
                dragging ? 'border-accent bg-surface-neutral' : 'border-border hover:border-border-strong bg-surface'
              }`}
            >
              <Upload className="size-5 text-text-muted" />
              <div className="text-center">
                <div className="text-[13px] font-semibold text-text-primary">Drop your CSV file here, or click to browse</div>
                <div className="mt-1 inline-flex items-center gap-1.5 rounded-[3px] bg-success-soft px-2.5 py-0.5 text-xs font-medium text-success">
                  <FileCheck className="size-3.5" />
                  {fileName} · 5 rows found
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-4 border-t border-border">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="flex items-center gap-1.5 h-8 px-3 rounded-md bg-accent hover:bg-accent-hover text-white text-[13px] font-medium transition cursor-pointer"
              >
                <span>Continue</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* STEP 2: SCHEMA MAPPING */}
        {step === 2 && (
          <div className="bg-surface border border-border rounded-lg p-7 flex flex-col gap-6">
            <div>
              <h2 className="text-sm font-semibold text-text-primary mb-1">Match your columns</h2>
              <p className="text-[13px] text-text-muted">
                Tell us which column in your file holds each piece of information.
              </p>
            </div>

            <div className="border border-border rounded-lg overflow-hidden text-xs">
              <table className="w-full text-[13px]">
                <thead className="bg-surface-neutral border-b border-border text-text-muted text-[11px] uppercase tracking-wide font-semibold">
                  <tr>
                    <th className="px-4 py-2 text-left">Ledgerly field</th>
                    <th className="px-4 py-2 text-left">Requirement</th>
                    <th className="px-4 py-2 text-left">Column in your file</th>
                    <th className="px-4 py-2 text-left">Example (row 1)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {mappings.map((m, idx) => (
                    <tr key={idx} className="hover:bg-canvas">
                      <td className="px-4 py-2.5 font-semibold text-text-primary">{m.label}</td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`text-[11px] px-2 py-0.5 rounded-[3px] font-medium ${
                            m.required
                              ? 'bg-danger-soft text-danger border border-danger/30'
                              : 'bg-surface-neutral text-text-muted border border-border'
                          }`}
                        >
                          {m.required ? 'Required' : 'Optional'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <select
                          value={m.csvColumn}
                          onChange={(e) => {
                            const updated = [...mappings];
                            updated[idx].csvColumn = e.target.value;
                            setMappings(updated);
                          }}
                          className="h-8 px-2 rounded-lg border border-border bg-surface text-[13px] text-text-primary focus:ring-1 focus:ring-accent"
                        >
                          <option value="Company Name">Company Name</option>
                          <option value="Cust ID">Cust ID</option>
                          <option value="Email">Email</option>
                          <option value="Tax Number">Tax Number</option>
                          <option value="Terms">Terms</option>
                          <option value="">Skip this field</option>
                        </select>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[11px] text-text-muted">
                        {parsedRows[0].data[m.csvColumn] || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-border">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="flex items-center gap-1.5 h-8 px-3 rounded-md border border-border bg-surface hover:bg-surface-neutral text-[13px] font-medium text-text-primary cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Back</span>
              </button>

              <button
                type="button"
                onClick={() => setStep(3)}
                className="flex items-center gap-1.5 h-8 px-3 rounded-md bg-accent hover:bg-accent-hover text-white text-[13px] font-medium transition cursor-pointer"
              >
                <span>Check my data</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* STEP 3: DRY-RUN VALIDATION */}
        {step === 3 && (
          <div className="bg-surface border border-border rounded-lg p-7 flex flex-col gap-6">
            <div>
              <h2 className="text-sm font-semibold text-text-primary mb-1">Check your data</h2>
              <p className="text-[13px] text-text-muted">
                This is a preview. Nothing has been saved yet.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-[3px] bg-surface-neutral px-3 py-1 text-[13px] font-medium text-text-primary">
                {parsedRows.length} rows checked
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-[3px] bg-success-soft px-3 py-1 text-[13px] font-medium text-success">
                <CheckCircle2 className="size-3.5" />{validRows.length} ready to import
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-[3px] bg-danger-soft px-3 py-1 text-[13px] font-medium text-danger">
                <AlertCircle className="size-3.5" />{errorRows.length} need fixing
              </span>
            </div>

            {/* Row-by-Row Result Table */}
            <div className="border border-border rounded-lg overflow-hidden text-xs">
              <table className="w-full text-[13px]">
                <thead className="bg-surface-neutral border-b border-border text-text-muted text-[11px] uppercase tracking-wide font-semibold">
                  <tr>
                    <th className="px-3 py-2 text-left">Row</th>
                    <th className="px-3 py-2 text-left">Result</th>
                    <th className="px-3 py-2 text-left">Customer</th>
                    <th className="px-3 py-2 text-left">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {parsedRows.map((r) => (
                    <tr
                      key={r.rowNum}
                      className={r.status === 'error' ? 'bg-danger-soft/30' : 'hover:bg-canvas'}
                    >
                      <td className="px-3 py-2 font-mono font-semibold text-text-muted">#{r.rowNum}</td>
                      <td className="px-3 py-2">
                        {r.status === 'valid' ? (
                          <span className="inline-flex items-center gap-1 text-success font-semibold text-[11px]">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Valid</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-danger font-semibold text-[11px]">
                            <AlertCircle className="w-3.5 h-3.5" />
                            <span>Needs fixing</span>
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono text-[11px]">
                        <strong>{r.data['Company Name'] || '<empty>'}</strong> ({r.data['Cust ID']})
                      </td>
                      <td className="px-3 py-2 text-[11px]">
                        {r.status === 'valid' ? (
                          <span className="text-text-muted">All checks passed</span>
                        ) : (
                          <span className="text-danger font-medium">{r.errorMessage}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="p-3 bg-surface-neutral border border-border rounded text-[11px] text-text-secondary flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-text-muted shrink-0" />
              <span>
                You can import the <strong>{validRows.length} ready rows</strong> now. Rows that need fixing will be skipped and saved to a separate file you can correct and re-upload.
              </span>
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-border">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="flex items-center gap-1.5 h-8 px-3 rounded-md border border-border bg-surface hover:bg-surface-neutral text-[13px] font-medium text-text-primary cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Back</span>
              </button>

              <button
                type="button"
                disabled={isApplying}
                onClick={handleApplyImport}
                className="flex items-center gap-1.5 h-8 px-3 rounded-md bg-accent hover:bg-accent-hover text-white text-[13px] font-medium transition cursor-pointer"
              >
                <span>{isApplying ? 'Importing…' : `Import ${validRows.length} rows`}</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* STEP 4: IMPORT COMPLETED */}
        {step === 4 && (
          <div className="bg-surface border border-border rounded-lg p-10 flex flex-col items-center justify-center gap-4 text-center">
            <CheckCircle2 className="size-6 text-success" />
            <div>
              <h2 className="text-xl font-semibold text-text-primary">Import complete</h2>
              <p className="text-xs text-text-muted mt-1">
                {appliedCount} {selectedEntity} were added to {currentCompany.name}. The import is recorded in your activity log.
              </p>
            </div>

            <div className="flex items-center gap-3 mt-4">
              <button
                type="button"
                onClick={() => navigate(`/${coSlug}/sales/customers`)}
                className="flex items-center gap-1.5 h-8 px-3 rounded-md bg-accent hover:bg-accent-hover text-white text-[13px] font-medium transition cursor-pointer"
              >
                <span>View customers</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setStep(1);
                  setParsedRows(parsedRows);
                }}
                className="flex items-center gap-1.5 h-8 px-3 rounded-md border border-border bg-surface hover:bg-surface-neutral text-[13px] font-medium text-text-primary cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Import another file</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
