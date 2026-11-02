<?php

declare(strict_types=1);

namespace App\Http\Requests\Procurement;

use App\Http\Requests\CompanyRequest;
use Illuminate\Validation\Rule;

/**
 * Filters of the procurement lists: `status`, `contact_id` (orders), `purchase_order_id` (receipts). Paging is CursorPage's.
 * The route says which list it is; a status that does not belong to it is a 422.
 */
final class ListPurchaseDocumentsRequest extends CompanyRequest
{
    private const array STATUSES = [
        'purchase-requisitions' => ['draft', 'pending_approval', 'approved', 'rejected', 'void'],
        'purchase-orders' => ['draft', 'pending_approval', 'approved', 'partly_received', 'received', 'closed', 'cancelled'],
        'goods-receipts' => ['recorded', 'reversed'],
    ];

    /** `?filter[status]=x` is accepted as well as `?status=x`. */
    protected function prepareForValidation(): void
    {
        $filter = $this->query('filter');
        if (is_array($filter)) {
            $this->merge(array_intersect_key($filter, array_flip(['status', 'contact_id', 'purchase_order_id'])));
        }
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        $family = explode('.', (string) $this->route()?->getName())[0];

        return [
            'status' => ['nullable', 'string', Rule::in(self::STATUSES[$family] ?? [])],
            'contact_id' => ['nullable', 'uuid'],
            'purchase_order_id' => ['nullable', 'uuid'],
        ];
    }

    /** @return array{status: string|null, contact_id: string|null, purchase_order_id: string|null} */
    public function filter(): array
    {
        $v = $this->validated();

        return [
            'status' => isset($v['status']) ? (string) $v['status'] : null,
            'contact_id' => isset($v['contact_id']) ? (string) $v['contact_id'] : null,
            'purchase_order_id' => isset($v['purchase_order_id']) ? (string) $v['purchase_order_id'] : null,
        ];
    }
}
