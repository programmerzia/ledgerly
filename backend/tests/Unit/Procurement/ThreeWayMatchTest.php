<?php

declare(strict_types=1);

use App\Domain\Procurement\LineFigures;
use App\Domain\Procurement\MatchLine;
use App\Domain\Procurement\PurchaseOrderStatus;
use App\Domain\Procurement\ReceiptRules;
use App\Domain\Procurement\RevisionLine;
use App\Domain\Procurement\RevisionRules;
use App\Domain\Procurement\ThreeWayMatch;
use App\Domain\Shared\Violation;

/*
 * The pure rules behind procurement (13 §10): three-way match, receipt limits, order status from quantities and what a
 * revision may change. Exact arithmetic; no database.
 */

/** One bill line against an order line priced 10,000 with ten received. */
function procMatchLine(int $price = 10000, string $quantity = '10', string $discount = '0', string $received = '10', string $elsewhere = '0', string $orderLine = 'ol-1', int $lineNo = 1): MatchLine
{
    return new MatchLine($lineNo, $orderLine, 'PO-1', $quantity, $price, $discount, 10000, $received, $elsewhere);
}

/** @param list<Violation> $violations @return list<string> */
function procCodes(array $violations): array
{
    return array_map(fn (Violation $v): string => $v->code, $violations);
}

it('passes a bill at exactly the order price', function (): void {
    expect(ThreeWayMatch::check([procMatchLine()], '0', '0'))->toBe([]);
});

it('passes a price within the tolerance, above or below', function (): void {
    expect(ThreeWayMatch::check([procMatchLine(10100)], '1', '0'))->toBe([])
        ->and(ThreeWayMatch::check([procMatchLine(9900)], '1', '0'))->toBe([])
        ->and(ThreeWayMatch::check([procMatchLine(10000)], '0', '0'))->toBe([]);
});

it('refuses a price just above the tolerance, above or below, naming the line', function (): void {
    $above = ThreeWayMatch::check([procMatchLine(10101, lineNo: 3)], '1', '0');
    $below = ThreeWayMatch::check([procMatchLine(9899)], '1', '0');

    expect(procCodes($above))->toBe(['match_price_mismatch'])->and($above[0]->lineNo)->toBe(3)
        ->and(procCodes($below))->toBe(['match_price_mismatch'])
        ->and(procCodes(ThreeWayMatch::check([procMatchLine(10001)], '0', '0')))->toBe(['match_price_mismatch']);
});

it('compares the price after discount, so a discount can bring a higher list price into line', function (): void {
    expect(procCodes(ThreeWayMatch::check([procMatchLine(11000)], '1', '0')))->toBe(['match_price_mismatch'])
        ->and(ThreeWayMatch::check([procMatchLine(11000, discount: '10')], '1', '0'))->toBe([])
        ->and(ThreeWayMatch::check([procMatchLine(11000, discount: '9.0909')], '0.01', '0'))->toBe([])
        ->and(procCodes(ThreeWayMatch::check([procMatchLine(10000, discount: '10')], '1', '0')))->toBe(['match_price_mismatch']);
});

it('passes a quantity at what was received and within the tolerance, and refuses above', function (): void {
    expect(ThreeWayMatch::check([procMatchLine(quantity: '10')], '0', '0'))->toBe([])
        ->and(ThreeWayMatch::check([procMatchLine(quantity: '11')], '0', '10'))->toBe([])
        ->and(procCodes(ThreeWayMatch::check([procMatchLine(quantity: '11.000001')], '0', '10')))->toBe(['match_quantity_exceeds_received'])
        ->and(procCodes(ThreeWayMatch::check([procMatchLine(quantity: '10.5')], '0', '0')))->toBe(['match_quantity_exceeds_received']);
});

it('counts what other bills already billed against what was received', function (): void {
    expect(ThreeWayMatch::check([procMatchLine(quantity: '4', elsewhere: '6')], '0', '0'))->toBe([])
        ->and(procCodes(ThreeWayMatch::check([procMatchLine(quantity: '5', elsewhere: '6')], '0', '0')))->toBe(['match_quantity_exceeds_received']);
});

it('adds up two bill lines on one order line and names the first', function (): void {
    $lines = [procMatchLine(quantity: '6', lineNo: 1), procMatchLine(quantity: '5', lineNo: 2)];
    $found = ThreeWayMatch::check($lines, '0', '0');

    expect(procCodes($found))->toBe(['match_quantity_exceeds_received'])->and($found[0]->lineNo)->toBe(1)
        ->and(ThreeWayMatch::check([procMatchLine(quantity: '6', lineNo: 1), procMatchLine(quantity: '4', lineNo: 2)], '0', '0'))->toBe([])
        ->and(ThreeWayMatch::check([procMatchLine(quantity: '6', lineNo: 1), procMatchLine(quantity: '6', lineNo: 2, orderLine: 'ol-2')], '0', '0'))->toBe([]);
});

it('refuses any quantity when nothing was received', function (): void {
    expect(procCodes(ThreeWayMatch::check([procMatchLine(quantity: '1', received: '0')], '0', '0')))->toBe(['match_quantity_exceeds_received'])
        ->and(procCodes(ThreeWayMatch::check([procMatchLine(quantity: '0.000001', received: '0')], '0', '50')))->toBe(['match_quantity_exceeds_received']);
});

it('reports a price and a quantity violation on the same line', function (): void {
    expect(procCodes(ThreeWayMatch::check([procMatchLine(12000, '12')], '0', '0')))->toBe(['match_price_mismatch', 'match_quantity_exceeds_received']);
});

/** An order line of $ordered with $received and $billed. */
function procFigures(string $ordered = '10', string $received = '0', string $billed = '0'): LineFigures
{
    return new LineFigures('ol', 'po', $ordered, $received, $billed);
}

it('refuses a receipt over what is open, beyond the tolerance', function (): void {
    $line = procFigures('10', '6');

    expect(ReceiptRules::overReceipt($line, '4', '0', 1))->toBeNull()
        ->and(ReceiptRules::overReceipt($line, '4.5', '10', 1))->toBeNull()
        ->and(ReceiptRules::overReceipt($line, '5', '10', 1))->toBeNull()
        ->and(ReceiptRules::overReceipt($line, '5.000001', '10', 2)?->code)->toBe('receipt_quantity_exceeds_open')
        ->and(ReceiptRules::overReceipt($line, '4.000001', '0', 2)?->lineNo)->toBe(2);
});

it('refuses a reversal that would leave less received than billed', function (): void {
    $line = procFigures('10', '8', '5');

    expect(ReceiptRules::reversal($line, '3', 1))->toBeNull()
        ->and(ReceiptRules::reversal($line, '3.000001', 1)?->code)->toBe('receipt_already_billed')
        ->and(ReceiptRules::reversal(procFigures('10', '8', '0'), '8', 1))->toBeNull();
});

it('derives the order status from its quantities', function (): void {
    expect(PurchaseOrderStatus::fromQuantities([procFigures('10', '0'), procFigures('5', '0')]))->toBe(PurchaseOrderStatus::Approved)
        ->and(PurchaseOrderStatus::fromQuantities([procFigures('10', '0.000001'), procFigures('5', '0')]))->toBe(PurchaseOrderStatus::PartlyReceived)
        ->and(PurchaseOrderStatus::fromQuantities([procFigures('10', '10'), procFigures('5', '2')]))->toBe(PurchaseOrderStatus::PartlyReceived)
        ->and(PurchaseOrderStatus::fromQuantities([procFigures('10', '10'), procFigures('5', '5')]))->toBe(PurchaseOrderStatus::Received)
        ->and(PurchaseOrderStatus::fromQuantities([procFigures('10', '11')]))->toBe(PurchaseOrderStatus::Received)
        ->and(PurchaseOrderStatus::fromQuantities([]))->toBe(PurchaseOrderStatus::Approved);
});

/** @param array<string, array{figures: LineFigures, item_id: string|null, linked: bool}> $existing */
function procRevise(array $proposed, array $existing): array
{
    return procCodes(RevisionRules::check($proposed, $existing));
}

it('lets a revision change the price of a used line but not shrink it below what was used', function (): void {
    $existing = ['a' => ['figures' => procFigures('10', '6', '4'), 'item_id' => 'item-1', 'linked' => true]];

    expect(procRevise([new RevisionLine(1, 'a', 'item-1', '6')], $existing))->toBe([])
        ->and(procRevise([new RevisionLine(1, 'a', 'item-1', '12')], $existing))->toBe([])
        ->and(procRevise([new RevisionLine(1, 'a', 'item-1', '5.999999')], $existing))->toBe(['revision_quantity_below_used']);
});

it('reports a revision that bills more than it keeps', function (): void {
    $existing = ['a' => ['figures' => procFigures('10', '2', '9'), 'item_id' => null, 'linked' => true]];

    expect(procRevise([new RevisionLine(1, 'a', null, '8')], $existing))->toBe(['revision_quantity_below_used']);
});

it('reports a line that is not on the order', function (): void {
    $found = RevisionRules::check([new RevisionLine(2, 'zzz', null, '1')], ['a' => ['figures' => procFigures(), 'item_id' => null, 'linked' => false]]);

    expect(procCodes($found))->toBe(['revision_line_unknown'])->and($found[0]->lineNo)->toBe(2);
});

it('keeps the item of a line with receipts or bills but not of an unused one', function (): void {
    $used = ['a' => ['figures' => procFigures('10', '1'), 'item_id' => 'item-1', 'linked' => true]];
    $unused = ['a' => ['figures' => procFigures('10'), 'item_id' => 'item-1', 'linked' => false]];

    expect(procRevise([new RevisionLine(1, 'a', 'item-2', '10')], $used))->toBe(['revision_item_fixed'])
        ->and(procRevise([new RevisionLine(1, 'a', 'item-2', '10')], $unused))->toBe([]);
});

it('refuses to remove a linked line, allows removing an unused one and adding a new one', function (): void {
    $existing = [
        'a' => ['figures' => procFigures('10', '1'), 'item_id' => null, 'linked' => true],
        'b' => ['figures' => procFigures('5'), 'item_id' => null, 'linked' => false],
    ];

    expect(procRevise([new RevisionLine(1, 'b', null, '5')], $existing))->toBe(['revision_line_in_use'])
        ->and(procRevise([new RevisionLine(1, 'a', null, '10'), new RevisionLine(2, null, null, '3')], $existing))->toBe([]);
});
