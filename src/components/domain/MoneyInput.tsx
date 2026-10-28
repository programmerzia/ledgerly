import React, { useState, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import {
  getCurrencySymbol,
  getCurrencyMinorUnits,
  parseMoneyToMinorUnits,
} from '@/lib/format';

export interface MoneyInputProps {
  value: number; // in integer minor units (e.g. 100000 = $1,000.00)
  onChange: (value: number) => void;
  currency?: string;
  disabled?: boolean;
  readOnly?: boolean;
  error?: string;
  placeholder?: string;
  className?: string;
  id?: string;
  name?: string;
  autoFocus?: boolean;
  onBlur?: () => void;
  onFocus?: () => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  allowNegative?: boolean;
  size?: 'sm' | 'md';
}

export const MoneyInput: React.FC<MoneyInputProps> = ({
  value,
  onChange,
  currency = 'USD',
  disabled = false,
  readOnly = false,
  error,
  placeholder = '0.00',
  className,
  id,
  name,
  autoFocus = false,
  onBlur,
  onFocus,
  onKeyDown,
  allowNegative = true,
  size = 'md',
}) => {
  const [isFocused, setIsFocused] = useState(false);
  const minors = getCurrencyMinorUnits(currency);
  const symbol = getCurrencySymbol(currency);
  const inputRef = useRef<HTMLInputElement>(null);

  // Helper to format minor units for blurred display
  const formatBlurredValue = (units: number): string => {
    if (units === 0 && !value) return '';
    const num = units / Math.pow(10, minors);
    const abs = Math.abs(num);
    const formatted = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: minors,
      maximumFractionDigits: minors,
    }).format(abs);

    if (num < 0) {
      return `(${formatted})`;
    }
    return formatted;
  };

  // Helper to format minor units for raw editing
  const formatRawValue = (units: number): string => {
    if (units === 0 && !value) return '';
    const num = units / Math.pow(10, minors);
    return num.toString();
  };

  const [displayValue, setDisplayValue] = useState(() => formatBlurredValue(value));

  // Sync external value changes when not actively typing
  useEffect(() => {
    if (!isFocused) {
      setDisplayValue(formatBlurredValue(value));
    }
  }, [value, isFocused, minors]);

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    setIsFocused(true);
    setDisplayValue(formatRawValue(value));
    onFocus?.();
  };

  const handleBlur = () => {
    setIsFocused(false);
    const parsed = parseMoneyToMinorUnits(displayValue, currency);
    const finalVal = allowNegative ? parsed : Math.max(0, parsed);
    onChange(finalVal);
    setDisplayValue(formatBlurredValue(finalVal));
    onBlur?.();
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setDisplayValue(raw);
    const parsed = parseMoneyToMinorUnits(raw, currency);
    const finalVal = allowNegative ? parsed : Math.max(0, parsed);
    onChange(finalVal);
  };

  const isNegative = value < 0;

  return (
    <div className="relative inline-flex items-center w-full">
      {/* Currency prefix tag */}
      <span
        className={cn(
          'absolute left-2.5 font-mono select-none pointer-events-none transition-colors text-xs',
          disabled ? 'text-ink-300' : 'text-ink-500'
        )}
      >
        {symbol}
      </span>

      <input
        ref={inputRef}
        id={id}
        name={name}
        type="text"
        inputMode="decimal"
        autoFocus={autoFocus}
        disabled={disabled}
        readOnly={readOnly}
        value={displayValue}
        placeholder={placeholder}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={onKeyDown}
        className={cn(
          'w-full bg-surface text-ink-900 border rounded-sm font-mono text-num text-right pl-7 pr-3 transition-colors',
          'focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:ring-offset-1',
          size === 'sm' ? 'h-8 text-xs py-1' : 'h-9 text-sm py-1.5',
          error
            ? 'border-danger focus:border-danger focus:ring-danger/20 text-danger'
            : isNegative
            ? 'border-ink-200 text-danger'
            : 'border-ink-200 hover:border-ink-300',
          disabled && 'bg-ink-100 text-ink-500 opacity-60 cursor-not-allowed',
          readOnly && 'bg-transparent border-transparent shadow-none cursor-default pr-0',
          className
        )}
      />
    </div>
  );
};
