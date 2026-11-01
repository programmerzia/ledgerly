<?php

declare(strict_types=1);

use App\Domain\Trade\InvoiceKind;
use App\Domain\Trade\LineAmount;
use App\Domain\Trade\PaymentStatus;
use App\Domain\Workflow\DocumentStatus;

it('prices a line once, HALF_UP, from quantity, unit price and discount', function (string $qty, int $price, string $discount, int $expected): void {
    expect(LineAmount::net($qty, $price, $discount))->toBe($expected);
})->with([
    'whole quantity' => ['2', 5000, '0', 10000],
    '10% off 25.50' => ['1', 2550, '10', 2295],          // 2295.0
    'fractional quantity' => ['1.5', 12000, '0', 18000],
    'tie rounds up: 0.5 × 3 = 1.5' => ['0.5', 3, '0', 2],
    'tie rounds up after discount: 101 × 0.5%' => ['1', 101, '99.5', 1], // 101 × 0.005 = 0.505 -> 1
    'below the tie rounds down: 7 × 0.0714%' => ['1', 7, '99.9286', 0], // 0.0050 -> 0
    'full discount' => ['3', 999, '100', 0],
    'tiny quantity' => ['0.000001', 1000000, '0', 1],
]);

it('keeps credit and debit notes with their parents', function (): void {
    expect(InvoiceKind::CreditNote->parent())->toBe(InvoiceKind::SalesInvoice)
        ->and(InvoiceKind::DebitNote->parent())->toBe(InvoiceKind::PurchaseBill)
        ->and(InvoiceKind::SalesInvoice->parent())->toBeNull()
        ->and(InvoiceKind::CreditNote->documentType())->toBe('invoice')
        ->and(InvoiceKind::DebitNote->documentType())->toBe('bill')
        ->and(InvoiceKind::PurchaseBill->sequenceKey('FY2026'))->toBe('doc:purchase_bill:FY2026')
        // Document keys sort before the journal key, so a posting takes the document number first (13 §8 level 3).
        ->and(strcmp(InvoiceKind::SalesInvoice->sequenceKey('FY2026'), 'journal:FY2026'))->toBeLessThan(0)
        ->and(strcmp(InvoiceKind::PurchaseBill->sequenceKey('FY2026'), 'journal:FY2026'))->toBeLessThan(0);
});

it('derives the business status like docStatus.ts', function (): void {
    $today = new DateTimeImmutable('2026-03-15');
    $due = fn (string $d) => new DateTimeImmutable($d);

    expect(PaymentStatus::of(DocumentStatus::Draft, 100, 0, $due('2026-01-01'), $today))->toBe(PaymentStatus::Draft)
        ->and(PaymentStatus::of(DocumentStatus::Reversed, 100, 0, $due('2026-01-01'), $today))->toBe(PaymentStatus::Reversed)
        ->and(PaymentStatus::of(DocumentStatus::Posted, 0, 100, $due('2026-01-01'), $today))->toBe(PaymentStatus::Paid)
        ->and(PaymentStatus::of(DocumentStatus::Posted, 50, 50, $due('2026-03-14'), $today))->toBe(PaymentStatus::Overdue)
        ->and(PaymentStatus::of(DocumentStatus::Posted, 50, 50, $due('2026-03-15'), $today))->toBe(PaymentStatus::PartiallyPaid) // due today is not late
        ->and(PaymentStatus::of(DocumentStatus::Posted, 100, 0, $due('2026-03-16'), $today))->toBe(PaymentStatus::AwaitingPayment);
});
