/**
 * A secret the server shows once (API token, webhook signing secret). Held only in the caller's component state:
 * never put it in a query cache, a store, or browser storage. Closing the panel drops it for good.
 */
import React, { useState } from 'react';
import { primary, secondary } from './form';

export const SecretOnce: React.FC<{ title: string; value: string; note: string; onDone: () => void }> = ({ title, value, note, onDone }) => {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  };
  return (
    <div role="alert" data-testid="secret-once" className="rounded-lg border border-warning/40 bg-warning-soft p-4">
      <h3 className="text-[13px] font-semibold text-text-primary">{title}</h3>
      <p className="mt-1 text-[13px] text-text-secondary">{note}</p>
      <code data-testid="secret-value" className="mt-3 block break-all rounded-md border border-border bg-surface px-3 py-2 font-mono text-[12px] text-text-primary select-all">{value}</code>
      <div className="mt-3 flex items-center gap-2">
        <button type="button" onClick={() => void copy()} className={`${secondary} h-8 px-3 text-[13px]`}>{copied ? 'Copied' : 'Copy'}</button>
        <button type="button" onClick={onDone} className={`${primary} h-8 px-3 text-[13px]`}>I have saved it</button>
        {failed && <span className="text-xs text-danger">Could not copy. Select the text and copy it by hand.</span>}
      </div>
    </div>
  );
};
