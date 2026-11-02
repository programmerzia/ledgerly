<?php

declare(strict_types=1);

namespace App\Policies\Procurement;

use App\Domain\Procurement\GoodsReceiptStatus;
use App\Models\Procurement\GoodsReceipt;
use App\Policies\PolicyContext;
use Illuminate\Contracts\Auth\Authenticatable;

/** Goods receipts (`goods_receipts.*`, tokens `goods_receipts:read|write`). A receipt is not edited; it is reversed by a person. */
final class GoodsReceiptPolicy
{
    public function __construct(private readonly PolicyContext $context) {}

    public function viewAny(Authenticatable $principal): bool
    {
        return $this->context->can($principal, 'goods_receipts.view', 'goods_receipts:read');
    }

    public function create(Authenticatable $principal): bool
    {
        return $this->context->can($principal, 'goods_receipts.create', 'goods_receipts:write');
    }

    public function view(Authenticatable $principal, GoodsReceipt $receipt): bool
    {
        return $this->context->can($principal, 'goods_receipts.view', 'goods_receipts:read', $receipt->company_id);
    }

    public function reverse(Authenticatable $principal, GoodsReceipt $receipt): bool
    {
        return $receipt->status === GoodsReceiptStatus::Recorded
            && $this->context->personCan($principal, 'goods_receipts.reverse', $receipt->company_id);
    }

    public function bill(Authenticatable $principal, GoodsReceipt $receipt): bool
    {
        return $receipt->status === GoodsReceiptStatus::Recorded
            && $this->context->can($principal, 'bills.create', 'bills:write', $receipt->company_id);
    }
}
