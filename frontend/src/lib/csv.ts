/**
 * CSV for "export selected". Pure and string-only so money never passes through a float: amounts are written from
 * integer minor units by digit manipulation.
 */
import { getCurrencyMinorUnits } from './format';

export type CsvCell = string | number | null | undefined;

const NUMERIC = /^-?\d+(\.\d+)?$/;
/** A cell a spreadsheet would run as a formula. Prefixed with an apostrophe so a name like "=cmd" stays text. */
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(v: CsvCell): string {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (typeof v === 'string' && FORMULA_START.test(s) && !NUMERIC.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: CsvCell[][]): string {
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** 123456 in USD becomes "1234.56"; -5 becomes "-0.05". No arithmetic on fractions. */
export function minorToDecimal(minor: number, currency: string): string {
  const digits = getCurrencyMinorUnits(currency);
  const negative = minor < 0;
  const abs = String(Math.abs(Math.trunc(minor))).padStart(digits + 1, '0');
  const whole = abs.slice(0, abs.length - digits);
  const frac = abs.slice(abs.length - digits);
  return `${negative ? '-' : ''}${digits === 0 ? whole : `${whole}.${frac}`}`;
}

export function downloadCsv(filename: string, rows: CsvCell[][]): void {
  const blob = new Blob(['﻿', toCsv(rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
