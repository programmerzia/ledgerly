import { selectByMode } from '@/data/select';
import { JournalViewLive } from './live/JournalViewLive';
import { BUSINESS_TODAY } from '@/lib/docStatus';
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '@/mock/api';
import { useLedgerStore } from '@/mock/store';
import { Journal, JournalLine } from '@/types';
import { PageHeader } from '@/components/domain/PageHeader';
import { StatusPill } from '@/components/domain/StatusPill';
import { JournalPaper } from './journal-view/JournalPaper';
import { JournalSidebar } from './journal-view/JournalSidebar';
import { BTN_SECONDARY } from '@/pages/Sales/invoice-view/shared';
import { SignDialog } from '@/components/domain/SignDialog';
import { formatMoney, formatDate } from '@/lib/format';
import { toast } from 'sonner';
import { RotateCcw, Printer, Paperclip, Upload, FileText, ChevronDown, ChevronUp } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';

const MockJournalView: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { currentCompany, currentUser, companySettings, accounts, journals, users, bankStatementLines, approveJournal, returnJournal, submitJournalForApproval } = useLedgerStore();
  const coSlug = currentCompany.slug;

  const [journal, setJournal] = useState<Journal | null>(null);
  const [loading, setLoading] = useState(true);
  const [isReverseOpen, setIsReverseOpen] = useState(false);
  const [isFixThisOpen, setIsFixThisOpen] = useState(false);
  const [isAttachOpen, setIsAttachOpen] = useState(false);
  const [signDialogOpen, setSignDialogOpen] = useState(false);
  const [signAction, setSignAction] = useState<'reverse' | 'fix_this' | 'approve' | null>(null);
  const [isReturnOpen, setIsReturnOpen] = useState(false);
  const [returnReason, setReturnReason] = useState('');
  const [showAccountingPreview, setShowAccountingPreview] = useState(false);
  const [reverseReason, setReverseReason] = useState('Correction of erroneous expense allocation');
  const [attachments, setAttachments] = useState<Array<{ name: string; size: string; date: string }>>([
    { name: 'Journal_Voucher_Authorization.pdf', size: '155 KB', date: '2026-10-24' },
    { name: 'Schedule_Calculation_Worksheet.xlsx', size: '240 KB', date: '2026-10-24' },
  ]);

  useEffect(() => {
    async function loadJournal() {
      if (!id) return;
      const res = await api.getJournalById(id);
      if (res) setJournal(res);
      setLoading(false);
    }
    loadJournal();
  }, [id, journals]);

  if (loading || !journal) {
    return (
      <div className="p-8 text-center text-xs text-text-muted flex items-center justify-center gap-2">
        <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        <span>Loading journal {id}...</span>
      </div>
    );
  }

  const handleConfirmSign = async (pin: string) => {
    try {
      if (signAction === 'approve') {
        const posted = approveJournal(journal.id, currentUser, pin, companySettings);
        setJournal(posted);
        toast.success(`Approved and posted as ${posted.number}`);
      } else if (signAction === 'reverse') {
        const res = await api.reverseJournal(journal.id, reverseReason);
        setJournal(res.original);
        toast.success(`Journal reversed. Reversal entry ${res.reversal.number} created and posted.`);
      } else if (signAction === 'fix_this') {
        await api.reverseJournal(journal.id, 'Reversed via Fix This flow');
        const dup = await api.duplicateJournal(journal.id);
        toast.success('Original journal reversed. Now editing corrected draft copy.');
        navigate(`/${coSlug}/journals/${dup.id}`);
        return;
      }
      setSignAction(null);
      setSignDialogOpen(false);
    } catch (err: any) {
      toast.error(err.message || 'Operation failed');
    }
  };

  const handleReturn = () => {
    const reason = returnReason.trim();
    if (!reason) return;
    try {
      const updated = returnJournal(journal.id, reason, currentUser);
      setJournal(updated);
      setIsReturnOpen(false);
      setReturnReason('');
      toast.success('Sent back to the maker as a draft');
    } catch (err: any) {
      toast.error(err.message || 'Could not send back');
    }
  };

  const handleSubmit = () => {
    try {
      setJournal(submitJournalForApproval(journal.id, currentUser));
      toast.success('Sent for approval');
    } catch (err: any) {
      toast.error(err.message || 'Could not submit');
    }
  };

  const bankLine = journal.source_type === 'bank_transaction'
    ? bankStatementLines.find((l: any) => l.id === journal.source_id || l.pending_journal_id === journal.id || l.matched_journal_id === journal.id)
    : undefined;
  const makerUser = users?.find((u: any) => u.id === (journal.submitted_by ?? journal.created_by));

  const handleDuplicate = async () => {
    const dup = await api.duplicateJournal(journal.id);
    toast.success(`Duplicate draft journal created: ${dup.reference}`);
    navigate(`/${coSlug}/journals/${dup.id}`);
  };

  const handleUploadAttachment = () => {
    const mockFile = {
      name: `Supporting_Schedule_${Date.now().toString().slice(-4)}.pdf`,
      size: '180 KB',
      date: BUSINESS_TODAY,
    };
    setAttachments((prev) => [mockFile, ...prev]);
    toast.success(`Attached ${mockFile.name} to journal entry.`);
  };

  return (
    <div className="flex flex-col gap-6 pb-20">
      <PageHeader
        breadcrumb={[{ label: 'Journals', to: `/${coSlug}/journals` }, { label: journal.number || 'Draft' }]}
        title={journal.number || 'Draft journal'}
        subtitle={journal.memo}
        meta={<StatusPill status={journal.status} />}
        actions={
          <button type="button" onClick={() => window.print()} className={BTN_SECONDARY}>
            <Printer className="size-4 text-text-muted" /> Download PDF
          </button>
        }
      />

      {journal.status === 'reversed' && journal.reversed_by_id && (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-neutral px-4 py-3 text-[13px] font-medium text-text-secondary">
          <span>
            This journal was reversed.{' '}
            <button type="button" className="underline" onClick={() => navigate(`/${coSlug}/journals/${journal.reversed_by_id}`)}>
              View the reversal
            </button>
          </span>
        </div>
      )}

      {journal.reversal_of_id && (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-neutral px-4 py-3 text-[13px] font-medium text-text-secondary">
          <span>
            This entry cancels another journal.{' '}
            <button type="button" className="underline" onClick={() => navigate(`/${coSlug}/journals/${journal.reversal_of_id}`)}>
              View the original
            </button>
          </span>
        </div>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <JournalPaper journal={journal} accounts={accounts} company={currentCompany} />
        <JournalSidebar
          journal={journal}
          currency={currentCompany.base_currency}
          currentUserId={currentUser.id}
          makerName={makerUser?.name}
          bankLineDescription={bankLine?.description}
          actions={{
            submit: handleSubmit,
            approve: () => {
              setSignAction('approve');
              setSignDialogOpen(true);
            },
            sendBack: () => setIsReturnOpen(true),
            print: () => window.print(),
            reverse: () => setIsReverseOpen(true),
            fixThis: () => setIsFixThisOpen(true),
            duplicate: handleDuplicate,
            attach: () => setIsAttachOpen(true),
            copyNumber: () => {
              navigator.clipboard?.writeText(journal.number || '').catch(() => undefined);
              toast.success('Journal number copied');
            },
          }}
        />
      </div>

      {/* Return for changes */}
      <Dialog open={isReturnOpen} onOpenChange={setIsReturnOpen}>
        <DialogContent className="max-w-md bg-surface-elevated border border-border p-6 shadow-popover rounded-lg">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold text-text-primary">Send back for changes</DialogTitle>
          </DialogHeader>
          <label htmlFor="journal-return-reason" className="text-xs font-semibold text-text-primary">Why are you sending it back?</label>
          <textarea
            id="journal-return-reason"
            autoFocus
            rows={3}
            value={returnReason}
            onChange={(e) => setReturnReason(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleReturn();
            }}
            placeholder="e.g. Wrong expense account"
            className="w-full rounded-lg border border-border bg-surface p-2 text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <DialogFooter className="mt-2 flex justify-end gap-2">
            <button type="button" onClick={() => setIsReturnOpen(false)} className="h-9 px-3 rounded-md border border-border bg-surface text-xs hover:bg-surface-neutral cursor-pointer">Cancel</button>
            <button type="button" onClick={handleReturn} disabled={!returnReason.trim()} className="h-9 px-3 rounded-md bg-warning text-white text-xs font-semibold disabled:opacity-50 cursor-pointer">Send back</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmation Reversal Dialog */}
      <Dialog open={isReverseOpen} onOpenChange={setIsReverseOpen}>
        <DialogContent className="max-w-lg bg-surface-elevated border border-border p-6 shadow-popover rounded-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-semibold text-text-primary">
              <RotateCcw className="w-5 h-5 text-danger" />
              <span>Reverse {journal.number}</span>
            </DialogTitle>
          </DialogHeader>

          <div className="text-xs text-text-secondary flex flex-col gap-3 mt-2">
            <div className="p-3 bg-danger-soft border border-danger/30 rounded-md text-danger">
              <p className="font-semibold">Posted entries cannot be edited</p>
              <p className="mt-1 text-[11px]">
                Instead, we add a new entry that swaps every debit and credit, which cancels this one out. Both stay visible in your records.
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-text-primary mb-1">
                Why are you reversing it? <span className="text-danger">*</span>
              </label>
              <input
                type="text"
                value={reverseReason}
                onChange={(e) => setReverseReason(e.target.value)}
                className="w-full h-8 px-2.5 rounded-md border border-border bg-surface text-xs text-text-primary focus:border-accent outline-hidden"
                placeholder="e.g. posted to the wrong account"
              />
            </div>

            <div className="border border-border rounded-md overflow-hidden">
              <button
                type="button"
                onClick={() => setShowAccountingPreview(!showAccountingPreview)}
                className="w-full flex items-center justify-between p-2.5 bg-surface-neutral text-xs font-semibold text-text-primary hover:bg-surface-neutral/80"
              >
                <span>See what the new entry will contain</span>
                {showAccountingPreview ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
              {showAccountingPreview && (
                <div className="p-3 bg-surface text-[11px] tabular-nums border-t border-border flex flex-col gap-1.5 max-h-48 overflow-y-auto">
                  {journal.lines.map((l, idx) => (
                    <div key={idx} className="flex justify-between text-text-muted">
                      <span>{l.description}:</span>
                      <span className="text-text-primary">
                        {l.debit > 0 ? `Cr ${formatMoney(l.debit)}` : `Dr ${formatMoney(l.credit)}`}
                      </span>
                    </div>
                  ))}
                  <p className="text-[10px] text-text-muted italic mt-1 font-sans">
                    Account balances return to what they were before this journal.
                  </p>
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setIsReverseOpen(false)}
              className="h-8 px-3 rounded-md border border-border bg-surface text-text-primary text-[13px] font-medium hover:bg-surface-neutral cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!reverseReason.trim()}
              onClick={() => {
                setIsReverseOpen(false);
                setSignAction('reverse');
                setSignDialogOpen(true);
              }}
              className="h-8 px-3 rounded-md bg-danger hover:bg-danger/90 text-white text-[13px] font-medium disabled:opacity-50 cursor-pointer"
            >
              Continue to PIN
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Fix This Dialog */}
      <Dialog open={isFixThisOpen} onOpenChange={setIsFixThisOpen}>
        <DialogContent className="max-w-md bg-surface-elevated border border-border p-6 shadow-popover rounded-lg">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold text-text-primary flex items-center gap-2">
              Fix {journal.number}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3 text-xs text-text-secondary mt-2">
            <p>Fixing a posted journal takes three steps, done for you:</p>
            <ol className="list-decimal pl-5 flex flex-col gap-1 text-[11px] text-text-primary">
              <li>The original is cancelled with a reversing entry.</li>
              <li>A new draft is created with the same lines.</li>
              <li>You land on the draft to correct and resubmit.</li>
            </ol>
            <p className="text-[11px] text-text-muted">You will be asked for your PIN to cancel the original.</p>
          </div>
          <DialogFooter className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setIsFixThisOpen(false)}
              className="h-8 px-3 rounded-md border border-border bg-surface text-text-primary text-[13px] font-medium hover:bg-surface-neutral cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                setIsFixThisOpen(false);
                setSignAction('fix_this');
                setSignDialogOpen(true);
              }}
              className="h-8 px-3 rounded-md bg-accent hover:bg-accent-hover text-white text-[13px] font-medium cursor-pointer"
            >
              Continue to PIN
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Attachments Dialog */}
      <Dialog open={isAttachOpen} onOpenChange={setIsAttachOpen}>
        <DialogContent className="max-w-md bg-surface-elevated border border-border p-6 shadow-popover rounded-lg">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold text-text-primary flex items-center gap-2">
              <Paperclip className="w-5 h-5 text-accent" />
              Files ({attachments.length})
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3 text-xs mt-2">
            <div className="flex justify-between items-center pb-2 border-b border-border">
              <span className="text-text-muted text-[11px]">Supporting documents for this journal</span>
              <button
                type="button"
                onClick={handleUploadAttachment}
                className="flex items-center gap-1.5 h-7 px-2 bg-surface-neutral hover:bg-surface-neutral/80 text-text-primary rounded text-[11px] font-semibold border border-border cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5 text-accent" />
                <span>Upload file</span>
              </button>
            </div>
            <div className="flex flex-col gap-2 max-h-60 overflow-y-auto">
              {attachments.map((file, i) => (
                <div key={i} className="flex items-center justify-between p-2.5 rounded border border-border bg-surface hover:bg-surface-neutral/40 text-xs">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-accent shrink-0" />
                    <div>
                      <div className="font-medium text-text-primary">{file.name}</div>
                      <div className="text-[10px] text-text-muted">{file.size} · Uploaded {file.date}</div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => toast.info(`Viewing ${file.name}`)}
                    className="text-accent text-[11px] font-semibold hover:underline cursor-pointer"
                  >
                    View
                  </button>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter className="mt-4">
            <button
              type="button"
              onClick={() => setIsAttachOpen(false)}
              className="h-8 px-3 rounded-md border border-border bg-surface text-text-primary text-[13px] font-medium hover:bg-surface-neutral cursor-pointer"
            >
              Close
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* PIN Signing Modal */}
      <SignDialog
        isOpen={signDialogOpen}
        onClose={() => {
          setSignDialogOpen(false);
          setSignAction(null);
        }}
        onConfirm={handleConfirmSign}
        documentTitle={`Journal Entry: ${journal.number || 'Manual Journal'}`}
        documentNumber={journal.number || 'Draft'}
        amount={journal.total_debit}
        currency={currentCompany.base_currency}
        periodName="Oct 2026"
        makerName={users?.find((u: any) => u.id === journal.created_by)?.name ?? "the maker"}
        actionTitle={
          signAction === 'approve'
            ? 'Approve and post'
            : signAction === 'reverse'
            ? 'Reverse journal'
            : 'Reverse and create draft'
        }
        consequenceText={
          signAction === 'approve'
            ? 'Approving posts this journal to your books with the next journal number. Mistakes are fixed later with a reversal.'
            : signAction === 'reverse'
            ? `Reversing adds an equal and opposite entry of ${formatMoney(journal.total_debit)} and restores your balances.`
            : `The original is cancelled and an editable draft copy is created for you to correct.`
        }
      />
    </div>
  );
};

/** The demo keeps its store-backed screen; live mode reads the API (docs/15). */
export const JournalView: React.FC = selectByMode({ mock: MockJournalView, live: JournalViewLive });
