import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { CheckCircle2, Clock, AlertTriangle, Download, X, Play, RotateCcw } from 'lucide-react';

interface DemoStepMetric {
  id: number;
  title: string;
  completed: boolean;
  timeSeconds: number;
  errorCount: number;
}

const initialSteps: DemoStepMetric[] = [
  { id: 1, title: 'Step 1: Persona Login & Approvals Waiting', completed: false, timeSeconds: 0, errorCount: 0 },
  { id: 2, title: 'Step 2: Create Sales Invoice (AR & Revenue)', completed: false, timeSeconds: 0, errorCount: 0 },
  { id: 3, title: 'Step 3: Segregation of Duties Check', completed: false, timeSeconds: 0, errorCount: 0 },
  { id: 4, title: 'Step 4: Receive Money & Auto-Allocation', completed: false, timeSeconds: 0, errorCount: 0 },
  { id: 5, title: 'Step 5: Bank Reconciliation Matching', completed: false, timeSeconds: 0, errorCount: 0 },
  { id: 6, title: 'Step 6: Fiscal Period Close Checklist', completed: false, timeSeconds: 0, errorCount: 0 },
  { id: 7, title: 'Step 7: Closed Period Posting Rejection', completed: false, timeSeconds: 0, errorCount: 0 },
  { id: 8, title: 'Step 8: Two-Approver Period Reopen', completed: false, timeSeconds: 0, errorCount: 0 },
  { id: 9, title: 'Step 9: Post Reversing Journal Entry', completed: false, timeSeconds: 0, errorCount: 0 },
  { id: 10, title: 'Step 10: Offline Mode Draft & Conflict', completed: false, timeSeconds: 0, errorCount: 0 },
  { id: 11, title: 'Step 11: 6-Digit PIN Signing & Lockout', completed: false, timeSeconds: 0, errorCount: 0 },
  { id: 12, title: 'Step 12: Supplier Payment Run with WHT', completed: false, timeSeconds: 0, errorCount: 0 },
  { id: 13, title: 'Step 13: FX Revaluation & Auto-Reversal', completed: false, timeSeconds: 0, errorCount: 0 },
  { id: 14, title: 'Step 14: Balance Sheet Pivot by Branch', completed: false, timeSeconds: 0, errorCount: 0 },
];

export const UsabilityTracker: React.FC = () => {
  const location = useLocation();
  const [isVisible, setIsVisible] = useState(false);
  const [steps, setSteps] = useState<DemoStepMetric[]>(initialSteps);
  const [activeStepId, setActiveStepId] = useState<number>(1);
  const [isTimerRunning, setIsTimerRunning] = useState(false);

  // Show if ?usability in URL or toggled
  useEffect(() => {
    if (location.search.includes('usability')) {
      setIsVisible(true);
    }
  }, [location.search]);

  // Global toggle shortcut: Ctrl+Shift+U
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'u') {
        e.preventDefault();
        setIsVisible((p) => !p);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Timer loop
  useEffect(() => {
    if (!isTimerRunning) return;
    const interval = setInterval(() => {
      setSteps((prev) =>
        prev.map((s) => (s.id === activeStepId ? { ...s, timeSeconds: s.timeSeconds + 1 } : s))
      );
    }, 1000);
    return () => clearInterval(interval);
  }, [isTimerRunning, activeStepId]);

  if (!isVisible) return null;

  const handleToggleComplete = (id: number) => {
    setSteps((prev) =>
      prev.map((s) => (s.id === id ? { ...s, completed: !s.completed } : s))
    );
    if (id < 14) setActiveStepId(id + 1);
  };

  const handleIncrementError = (id: number) => {
    setSteps((prev) =>
      prev.map((s) => (s.id === id ? { ...s, errorCount: s.errorCount + 1 } : s))
    );
  };

  const exportMetricsJson = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(steps, null, 2));
    const dlAnchor = document.createElement('a');
    dlAnchor.setAttribute('href', dataStr);
    dlAnchor.setAttribute('download', `ledgerly_usability_metrics_${Date.now()}.json`);
    document.body.appendChild(dlAnchor);
    dlAnchor.click();
    dlAnchor.remove();
  };

  const completedCount = steps.filter((s) => s.completed).length;

  return (
    <div className="fixed bottom-8 right-6 w-96 bg-surface-elevated border border-line-border rounded-lg shadow-2xl p-4 z-50 flex flex-col gap-3 text-xs animate-in slide-in-from-bottom-4 duration-150">
      {/* Header */}
      <div className="flex items-center justify-between pb-2 border-b border-line-border">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-brand-teal" />
          <span className="font-bold text-ink-900">Usability & Demo Metric Tracker</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={exportMetricsJson}
            className="p-1 rounded text-ink-muted hover:text-ink-900 hover:bg-surface-neutral transition"
            title="Export Telemetry JSON"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setIsVisible(false)}
            className="p-1 rounded text-ink-muted hover:text-ink-900 hover:bg-surface-neutral transition"
            title="Close Panel (Ctrl+Shift+U)"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Progress & Controls */}
      <div className="flex items-center justify-between text-[11px] bg-surface-neutral p-2 rounded-sm border border-line-border">
        <div>
          <span className="text-ink-muted">Progress: </span>
          <span className="font-bold text-brand-teal font-mono">
            {completedCount} / 14 Steps ({Math.round((completedCount / 14) * 100)}%)
          </span>
        </div>
        <button
          type="button"
          onClick={() => setIsTimerRunning((p) => !p)}
          className={`px-2 py-0.5 rounded text-[10px] font-semibold transition flex items-center gap-1 ${
            isTimerRunning
              ? 'bg-danger text-white'
              : 'bg-brand-teal text-white'
          }`}
        >
          <Play className="w-2.5 h-2.5" />
          <span>{isTimerRunning ? 'Pause' : 'Start Timer'}</span>
        </button>
      </div>

      {/* Steps List */}
      <div className="divide-y divide-line-border/60 max-h-64 overflow-y-auto pr-1">
        {steps.map((s) => {
          const isActive = s.id === activeStepId;
          const mins = Math.floor(s.timeSeconds / 60);
          const secs = s.timeSeconds % 60;
          const timeStr = `${mins}:${secs < 10 ? '0' : ''}${secs}`;

          return (
            <div
              key={s.id}
              onClick={() => setActiveStepId(s.id)}
              className={`py-1.5 px-2 flex items-center justify-between rounded cursor-pointer transition ${
                isActive ? 'bg-brand-teal/10 font-medium' : 'hover:bg-surface-neutral'
              }`}
            >
              <div className="flex items-center gap-2 truncate max-w-[200px]">
                <input
                  type="checkbox"
                  checked={s.completed}
                  onChange={() => handleToggleComplete(s.id)}
                  onClick={(e) => e.stopPropagation()}
                  className="rounded border-line-border text-brand-teal focus:ring-brand-teal"
                />
                <span className={`text-[11px] truncate ${s.completed ? 'line-through text-ink-muted' : 'text-ink-900'}`}>
                  {s.title}
                </span>
              </div>

              <div className="flex items-center gap-2 font-mono text-[10px]">
                <span className="text-ink-muted">{timeStr}</span>
                {s.errorCount > 0 && (
                  <span className="text-danger font-semibold bg-danger-bg px-1 rounded">
                    {s.errorCount} err
                  </span>
                )}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleIncrementError(s.id);
                  }}
                  className="px-1 text-ink-muted hover:text-danger rounded hover:bg-surface-subtle"
                  title="Record User Friction/Error"
                >
                  +err
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
