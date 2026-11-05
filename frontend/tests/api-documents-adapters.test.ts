import { describe, expect, it } from 'vitest';
import { docBasePath, filenameFrom, hasQueuedSend, looksLikeEmail, parseRecipients, sendLook, type ApiSend } from '../src/api/adapters/documents';
import { isHexColor, logoProblem, lookPatch, toLookForm, unknownPlaceholders } from '../src/api/adapters/documentLook';

describe('document paths and recipients', () => {
  it('addresses a statement under the contact and everything else under its own family', () => {
    expect(docBasePath('invoices', 'abc')).toBe('invoices/abc');
    expect(docBasePath('wht-certificates', 'abc')).toBe('wht-certificates/abc');
    expect(docBasePath('contacts', 'abc')).toBe('contacts/abc/statement');
  });

  it('splits recipients on commas, semicolons and spaces, lower-cases and drops duplicates and blanks', () => {
    expect(parseRecipients('A@B.com, c@d.com; a@b.com  e@f.com,')).toEqual(['a@b.com', 'c@d.com', 'e@f.com']);
    expect(parseRecipients('  ')).toEqual([]);
  });

  it('recognises something that looks like an address', () => {
    expect(looksLikeEmail('a@b.co')).toBe(true);
    expect(['a@b', 'a b@c.d', '@c.d', 'plain'].some(looksLikeEmail)).toBe(false);
  });

  it('reads the file name from the download header', () => {
    expect(filenameFrom('attachment; filename=Invoice-INV-1.pdf', 'x.pdf')).toBe('Invoice-INV-1.pdf');
    expect(filenameFrom('attachment; filename="Credit-note-CN 1.pdf"', 'x.pdf')).toBe('Credit-note-CN 1.pdf');
    expect(filenameFrom(null, 'x.pdf')).toBe('x.pdf');
  });
});

describe('send log words', () => {
  it('says what each status means and never claims delivery', () => {
    expect(sendLook('sent').label).toBe('Sent');
    expect(sendLook('failed')).toEqual({ label: 'Not sent', tone: 'bad' });
    expect(sendLook('queued').tone).toBe('wait');
  });

  it('keeps polling only while a mail is still queued', () => {
    const row = (status: string) => ({ status }) as ApiSend;
    expect(hasQueuedSend([row('sent'), row('queued')])).toBe(true);
    expect(hasQueuedSend([row('sent'), row('failed')])).toBe(false);
    expect(hasQueuedSend(undefined)).toBe(false);
  });
});

describe('document look form', () => {
  const settings = {
    document_look: { accent_color: '#1F4E79', footer_text: '', payment_instructions: 'IBAN 1', has_logo: false },
    email_templates: {
      invoice: { subject: 'S {{document_number}}', body: 'B' }, credit_note: { subject: 'c', body: 'c' },
      statement: { subject: 's', body: 's' }, payment_advice: { subject: 'p', body: 'p' },
    },
  };

  it('sends only what changed', () => {
    const saved = toLookForm(settings);
    expect(lookPatch(saved, saved)).toEqual({});
    const next = { ...saved, accent_color: '#0a7c5a', email: { ...saved.email, invoice: { subject: 'New', body: 'B' } } };
    expect(lookPatch(saved, next)).toEqual({ accent_color: '#0a7c5a', email_templates: { invoice: { subject: 'New', body: 'B' } } });
    expect(lookPatch(saved, { ...saved, accent_color: '#1f4e79' })).toEqual({});
  });

  it('checks colours, placeholders and the logo file before sending', () => {
    expect(isHexColor('#1F4E79')).toBe(true);
    expect(['red', '#12345', '1F4E79'].some(isHexColor)).toBe(false);
    const allowed = ['total', 'company_name'];
    expect(unknownPlaceholders('Hi {{ total }} {{company_name}}', allowed)).toEqual([]);
    expect(unknownPlaceholders('{{ nope }} {{ system("id") }} {{nope}}', allowed)).toEqual(['nope', 'system("id")']);
    expect(logoProblem({ type: 'image/png', size: 1000 })).toBeNull();
    expect(logoProblem({ type: 'image/svg+xml', size: 1000 })).toMatch(/PNG or JPEG/);
    expect(logoProblem({ type: 'image/png', size: 600 * 1024 })).toMatch(/512 KB/);
  });
});
