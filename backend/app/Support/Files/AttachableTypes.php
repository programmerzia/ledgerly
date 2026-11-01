<?php

declare(strict_types=1);

namespace App\Support\Files;

use App\Contracts\Postable;
use App\Domain\Trade\InvoiceKind;
use App\Domain\Workflow\DocumentStatus;
use App\Models\BaseModel;
use App\Models\Ledger\Journal;
use App\Models\Trade\Contact;
use App\Models\Trade\Invoice;
use App\Models\Trade\Settlement;

/**
 * The allowlist of things a file can be attached to (plan 2.17) and what it takes, from 02 §5 and 13 §7: attaching
 * needs the view permission of the parent's module and its create/manage permission; reading needs the view
 * permission. A settlement's module follows its kind, like SettlementPolicy.
 * `invoice` and `bill` are two views of one table (`kind`), as in the routes.
 */
final class AttachableTypes
{
    /** @var array<string, array{model: class-string<BaseModel>, view: string, write: string}> */
    private const array MAP = [
        'journal' => ['model' => Journal::class, 'view' => 'journals.view', 'write' => 'journals.create'],
        'invoice' => ['model' => Invoice::class, 'view' => 'invoices.view', 'write' => 'invoices.create'],
        'bill' => ['model' => Invoice::class, 'view' => 'bills.view', 'write' => 'bills.create'],
        'contact' => ['model' => Contact::class, 'view' => 'contacts.view', 'write' => 'contacts.manage_customers'],
        // Receipts, payments and refunds: the module follows the kind (see viewPermission); these are the receipt defaults.
        'settlement' => ['model' => Settlement::class, 'view' => 'receipts.view', 'write' => 'receipts.create'],
    ];

    /** @return list<string> */
    public static function names(): array
    {
        return array_keys(self::MAP);
    }

    /** The permission to read files of a $type; with the parent, a settlement's follows its kind (`receipts` or `payments`). */
    public static function viewPermission(string $type, ?BaseModel $parent = null): string
    {
        return $parent instanceof Settlement ? $parent->module().'.view' : self::MAP[$type]['view'];
    }

    /** The permission to add or remove a file on $parent; a supplier or both-kind contact needs the broader `contacts.manage`. */
    public static function writePermission(string $type, ?BaseModel $parent = null): string
    {
        if ($parent instanceof Settlement) {
            return $parent->module().'.create';
        }
        if ($type === 'contact' && $parent instanceof Contact && $parent->kind !== 'customer') {
            return 'contacts.manage';
        }

        return self::MAP[$type]['write'];
    }

    /** The parent in $companyId, or null when it does not exist there (another company's id is the same as none). */
    public static function find(string $type, string $companyId, string $id): ?BaseModel
    {
        if (! isset(self::MAP[$type])) {
            return null;
        }
        $query = self::MAP[$type]['model']::query()->whereKey($id)->where('company_id', $companyId);
        if ($type === 'invoice' || $type === 'bill') {
            $kinds = $type === 'invoice' ? InvoiceKind::sales() : InvoiceKind::purchases();
            $query->whereIn('kind', InvoiceKind::values(...$kinds));
        }

        return $query->first();
    }

    /** Evidence rule (02 §5): once a document is posted (or reversed), its files stay. Contacts have no such state. */
    public static function isPosted(BaseModel $parent): bool
    {
        return $parent instanceof Postable && in_array($parent->documentStatus(), [DocumentStatus::Posted, DocumentStatus::Reversed], true);
    }
}
