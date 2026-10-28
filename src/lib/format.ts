/**
 * Money and date formatting functions for controls-grade accounting.
 * Rule: Money is stored as integer minor units (e.g. cents) and never floats.
 * UI displays tabular numbers, correct decimal units, and negative formatting.
 */

const CURRENCY_MINORS: Record<string, number> = {
  USD: 2,
  KES: 2,
  SOS: 2,
  EUR: 2,
  GBP: 2,
  JPY: 0,
};

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  KES: 'KSh',
  SOS: 'S',
  EUR: '€',
  GBP: '£',
};

export function getCurrencyMinorUnits(currency: string): number {
  return CURRENCY_MINORS[currency.toUpperCase()] ?? 2;
}

export function getCurrencySymbol(currency: string): string {
  return CURRENCY_SYMBOLS[currency.toUpperCase()] ?? currency;
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

  const formatter = new Intl.NumberFormat(locale, {
    minimumFractionDigits: minors,
    maximumFractionDigits: minors,
  });

  const formattedNum = formatter.format(absValue);
  const symbol = showCurrency ? `${getCurrencySymbol(currency)} ` : '';

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
