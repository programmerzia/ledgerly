/** Online invoice links (3c.7b): labels for the issuer's panel and for the customer's page. */
import type { components } from '../schema';

export type ApiLink = components['schemas']['InvoiceShareLinkResource'];
export type PublicInvoice = components['schemas']['PublicInvoiceResource'];

/** The lifetimes offered when making a link. `null` lasts until it is revoked. */
export const EXPIRY_CHOICES: { value: number | null; label: string }[] = [
  { value: null, label: 'Until I turn it off' },
  { value: 7, label: '7 days' },
  { value: 30, label: '30 days' },
  { value: 90, label: '90 days' },
];

export type Tone = 'ok' | 'wait' | 'bad';

export function linkStatusLook(status: string): { label: string; tone: Tone } {
  if (status === 'active') return { label: 'Active', tone: 'ok' };
  if (status === 'expired') return { label: 'Expired', tone: 'wait' };
  return { label: 'Turned off', tone: 'bad' };
}

/** "Opened 3 times, last on …" or "Not opened yet". */
export function viewsLine(link: Pick<ApiLink, 'view_count' | 'last_viewed_at'>, format: (iso: string) => string): string {
  if (link.view_count === 0) return 'Not opened yet';
  return `Opened ${link.view_count} time${link.view_count === 1 ? '' : 's'}${link.last_viewed_at ? `, last on ${format(link.last_viewed_at)}` : ''}`;
}

/** The customer page's status in words. */
export function publicStatusLook(status: string): { label: string; tone: Tone } {
  switch (status) {
    case 'paid':
      return { label: 'Paid', tone: 'ok' };
    case 'partially_paid':
      return { label: 'Partly paid', tone: 'wait' };
    case 'overdue':
      return { label: 'Overdue', tone: 'bad' };
    case 'reversed':
      return { label: 'Cancelled', tone: 'bad' };
    default:
      return { label: 'Awaiting payment', tone: 'wait' };
  }
}

/** A reversed invoice owes nothing, so it shows no balance. */
export const showsBalance = (inv: Pick<PublicInvoice, 'status' | 'balance_due'>): boolean => inv.status !== 'reversed' && inv.balance_due != null;

/** The part of the address that identifies the page; used to keep the token out of anything logged. */
export const tokenFromPath = (pathname: string): string | null => /^\/i\/([A-Za-z0-9_-]{43})\/?$/.exec(pathname)?.[1] ?? null;
