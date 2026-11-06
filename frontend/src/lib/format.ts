/**
 * Money and date formatting functions for controls-grade accounting.
 * Rule: Money is stored as integer minor units (e.g. cents) and never floats.
 * UI displays tabular numbers, correct decimal units, and negative formatting.
 */

const CURRENCY_MINORS: Record<string, number> = {
  USD: 2,
  CHF: 2,
  KES: 2,
  SOS: 2,
  EUR: 2,
  GBP: 2,
  BDT: 2,
  AED: 2,
  SAR: 2,
  JPY: 0,
};

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  CHF: 'CHF',
  KES: 'KSh',
  SOS: 'Sh.So.',
  EUR: '€',
  GBP: '£',
  BDT: 'Tk',
  AED: 'Dhs',
  SAR: 'SR',
};

/**
 * A company's date and number format (plan 3c.26b), set once the live company is known. `null` keeps the demo's original en-US look.
 * Keys match the server's FormatPreferences (app/Domain/Shared). This changes the text only; money stays integer minor units, and
 * typed amounts still use a dot for decimals.
 */
export interface FormatPrefs {
  date: string;
  number: string;
}

const DATE_PARTS: Record<string, (d: string, m: string, y: string, mon: string) => string> = {
  dmy: (d, m, y) => `${d}/${m}/${y}`,
  mdy: (d, m, y) => `${m}/${d}/${y}`,
  ymd: (d, m, y) => `${y}-${m}-${d}`,
  d_mon_y: (d, _m, y, mon) => `${d} ${mon} ${y}`,
};

const NUMBER_SEPARATORS: Record<string, { group: string; decimal: string }> = {
  comma_dot: { group: ',', decimal: '.' },
  dot_comma: { group: '.', decimal: ',' },
  space_comma: { group: '\u202f', decimal: ',' },
  apostrophe_dot: { group: '\u2019', decimal: '.' },
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

let currentFormats: FormatPrefs | null = null;

export function setFormatPrefs(prefs: FormatPrefs | null): void {
  currentFormats = prefs && DATE_PARTS[prefs.date] && NUMBER_SEPARATORS[prefs.number] ? prefs : null;
}

export function getFormatPrefs(): FormatPrefs | null {
  return currentFormats;
}

/** Integer minor units as grouped text with the company's separators, or null when no company format is set. */
function groupedByCompany(absMinor: number, decimals: number): string | null {
  const sep = currentFormats ? NUMBER_SEPARATORS[currentFormats.number] : undefined;
  if (!sep) return null;
  let digits = String(Math.round(absMinor));
  if (decimals > 0) digits = digits.padStart(decimals + 1, '0');
  const whole = decimals > 0 ? digits.slice(0, -decimals) : digits;
  const fraction = decimals > 0 ? sep.decimal + digits.slice(-decimals) : '';
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, sep.group) + fraction;
}

export function getCurrencyMinorUnits(currency: string): number {
  return CURRENCY_MINORS[currency.toUpperCase()] ?? 2;
}

export function getCurrencySymbol(currency: string): string {
  return CURRENCY_SYMBOLS[currency.toUpperCase()] ?? currency;
}

/** "$1,250.00" but "KSh 1,250.00": sign-like symbols sit on the figure, letter codes get a space. */
function currencyPrefix(currency: string): string {
  const symbol = getCurrencySymbol(currency);
  return /\p{L}/u.test(symbol) ? `${symbol}\u00a0` : symbol;
}

/**
 * Formats integer minor units to localized currency string.
 * On reports: negative numbers are enclosed in parentheses: (1,250.00)
 * In grids: negative numbers can be formatted with minus sign or parentheses
 */
export function formatMoney(
  minorUnits: number | bigint | null | undefined,
  currency = 'USD',
  options: {
    parenthesesNegative?: boolean;
    showCurrency?: boolean;
    locale?: string;
  } = {}
): string {
  if (minorUnits === null || minorUnits === undefined) {
    return '—';
  }

  const {
    parenthesesNegative = false,
    showCurrency = true,
    locale = 'en-US',
  } = options;

  const minors = getCurrencyMinorUnits(currency);
  const numericValue = Number(minorUnits) / Math.pow(10, minors);
  const isNegative = numericValue < 0;
  const absValue = Math.abs(numericValue);

  const byCompany = groupedByCompany(Math.abs(Number(minorUnits)), minors);
  const formatter = new Intl.NumberFormat(locale, {
    minimumFractionDigits: minors,
    maximumFractionDigits: minors,
  });

  const formattedNum = byCompany ?? formatter.format(absValue);
  const symbol = showCurrency ? currencyPrefix(currency) : '';

  if (isNegative) {
    if (parenthesesNegative) {
      return `(${symbol}${formattedNum})`;
    }
    return `-${symbol}${formattedNum}`;
  }

  return `${symbol}${formattedNum}`;
}

/**
 * Parses user input (e.g., "$1,250.50", "-150", "(42.00)") into integer minor units.
 */
export function parseMoneyToMinorUnits(input: string | number, currency = 'USD'): number {
  if (typeof input === 'number') {
    return Math.round(input);
  }

  if (!input || typeof input !== 'string') return 0;
  let str = input.trim();
  let isNegative = false;

  // Handle accounting parentheses negative e.g. (100.50)
  if (str.startsWith('(') && str.endsWith(')')) {
    isNegative = true;
    str = str.slice(1, -1).trim();
  } else if (str.startsWith('-')) {
    isNegative = true;
    str = str.slice(1).trim();
  }

  // Strip currency symbols and commas
  const cleaned = str.replace(/[^0-9.]/g, '');
  if (!cleaned) return 0;

  const floatVal = parseFloat(cleaned);
  if (isNaN(floatVal)) return 0;

  const minors = getCurrencyMinorUnits(currency);
  const minorUnits = Math.round(floatVal * Math.pow(10, minors));
  return isNegative ? -minorUnits : minorUnits;
}

/**
 * Formats an ISO date string (YYYY-MM-DD) into locale display date.
 */
export function formatDate(dateString: string | null | undefined, locale = 'en-US'): string {
  if (!dateString) return '—';
  try {
    const parts = dateString.split('T')[0].split('-');
    if (parts.length === 3) {
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const day = parseInt(parts[2], 10);
      if (currentFormats && year > 0 && month >= 0 && month < 12) {
        const pad = (n: number, w = 2) => String(n).padStart(w, '0');
        return DATE_PARTS[currentFormats.date](pad(day), pad(month + 1), pad(year, 4), MONTHS[month]);
      }
      const d = new Date(year, month, day);
      return new Intl.DateTimeFormat(locale, {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
      }).format(d);
    }
    return dateString;
  } catch {
    return dateString;
  }
}

/**
 * Formats an ISO datetime string into human readable date + time.
 */
export function formatDateTime(dateTimeString: string | null | undefined, locale = 'en-US'): string {
  if (!dateTimeString) return '—';
  try {
    const d = new Date(dateTimeString);
    if (currentFormats) {
      const pad = (n: number) => String(n).padStart(2, '0');
      const iso = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      return `${formatDate(iso)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
    return new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(d);
  } catch {
    return dateTimeString;
  }
}

/**
 * Relative time helper for activity logs and notifications
 */
export function formatRelativeTime(dateString: string): string {
  try {
    const d = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHours = Math.floor(diffMin / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return formatDate(dateString);
  } catch {
    return dateString;
  }
}

/**
 * Commercial rounding: ROUND_HALF_UP (away from zero, so -0.5 -> -1, 0.5 -> 1).
 * Standard for base-currency conversions and ledgers (D1).
 * Avoids JS Math.round error on negative numbers (Math.round(-0.5) is -0).
 */
/**
 * Short time-zone abbreviation for a company's IANA zone, e.g. "CET" for Europe/Zurich.
 * Used to give audit-log timestamps their missing time-zone context.
 */
export function timezoneAbbreviation(timezone: string, date: string | Date = new Date()): string {
  if (!timezone) return '';
  try {
    const parts = new Intl.DateTimeFormat('en', { timeZone: timezone, timeZoneName: 'short' }).formatToParts(new Date(date));
    return parts.find((p) => p.type === 'timeZoneName')?.value ?? timezone;
  } catch {
    return timezone;
  }
}

export function roundHalfUp(val: number): number {
  const sign = val < 0 ? -1 : 1;
  const abs = Math.abs(val);
  const eps = Number.EPSILON * 100;
  return sign * Math.round(abs + eps);
}
