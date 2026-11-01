<?php

declare(strict_types=1);

namespace App\Domain\Trade;

use App\Domain\Ledger\JournalType;

/**
 * The four kinds that share the `invoices` table (05 §9). Sales kinds belong to `/invoices` and the workflow
 * type `invoice`; purchase kinds to `/bills` and `bill`. Credit and debit notes carry positive amounts: the kind
 * makes them reverse their parent's accounting.
 */
enum InvoiceKind: string
{
    case SalesInvoice = 'sales_invoice';
    case CreditNote = 'credit_note';
    case PurchaseBill = 'purchase_bill';
    case DebitNote = 'debit_note';

    public function isSales(): bool
    {
        return $this === self::SalesInvoice || $this === self::CreditNote;
    }

    public function isNote(): bool
    {
        return $this === self::CreditNote || $this === self::DebitNote;
    }

    /** The workflow document type, and the permission module is its plural (`invoices.submit`, `bills.submit`). */
    public function documentType(): string
    {
        return $this->isSales() ? 'invoice' : 'bill';
    }

    /** The kind a note refers to. */
    public function parent(): ?self
    {
        return match ($this) {
            self::CreditNote => self::SalesInvoice,
            self::DebitNote => self::PurchaseBill,
            default => null,
        };
    }

    public function journalType(): JournalType
    {
        return $this->isSales() ? JournalType::Sales : JournalType::Purchase;
    }

    /**
     * Contact kinds that may be the counterparty.
     *
     * @return list<string>
     */
    public function contactKinds(): array
    {
        return $this->isSales() ? ['customer', 'both'] : ['supplier', 'both'];
    }

    /** Number prefix; the fiscal year name and a dash follow. */
    public function prefix(): string
    {
        return match ($this) {
            self::SalesInvoice => 'INV',
            self::CreditNote => 'CN',
            self::PurchaseBill => 'BILL',
            self::DebitNote => 'DN',
        };
    }

    /**
     * Sequence key per kind and fiscal year. Sorts before `journal:` so a posting takes the document number first
     * and the journal number second, in key order (13 §8 level 3).
     */
    public function sequenceKey(string $fiscalYear): string
    {
        return 'doc:'.$this->value.':'.$fiscalYear;
    }

    public function label(): string
    {
        return match ($this) {
            self::SalesInvoice => 'invoice',
            self::CreditNote => 'credit note',
            self::PurchaseBill => 'bill',
            self::DebitNote => 'debit note',
        };
    }

    /** @return list<self> */
    public static function sales(): array
    {
        return [self::SalesInvoice, self::CreditNote];
    }

    /** @return list<self> */
    public static function purchases(): array
    {
        return [self::PurchaseBill, self::DebitNote];
    }

    /** @return list<string> */
    public static function values(self ...$kinds): array
    {
        return array_values(array_map(fn (self $k): string => $k->value, $kinds));
    }
}
