import { describe, expect, it } from 'vitest';
import { bellKind, toBellNotification, type ApiNotification } from '@/api/adapters/notifications';

const base: ApiNotification = {
  id: 'n1', kind: 'approval_requested', title: 'Invoice INV-1 needs your approval', body: 'It is waiting for a Approver.',
  subject_type: 'invoice', subject_id: 'i1', link: 'approvals', read: false, created_at: new Date().toISOString(),
};

describe('notification adapter', () => {
  it('puts the company slug in front of the link and marks unread', () => {
    const n = toBellNotification(base, 'acme');
    expect(n.link).toBe('/acme/approvals');
    expect(n.unread).toBe(true);
    expect(n.kind).toBe('approval');
    expect(n.time).toBe('just now');
  });

  it('falls back to the approvals inbox with no link and tolerates a missing body', () => {
    const n = toBellNotification({ ...base, link: null, body: null, read: true }, 'acme');
    expect(n.link).toBe('/acme/approvals');
    expect(n.desc).toBe('');
    expect(n.unread).toBe(false);
  });

  it('groups the server kinds', () => {
    expect(bellKind('approval_reminder')).toBe('approval');
    expect(bellKind('document_returned')).toBe('approval');
    expect(bellKind('import_failed')).toBe('import');
    expect(bellKind('report_ready')).toBe('report');
    expect(bellKind('send_failed')).toBe('send');
  });
});
