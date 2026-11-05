<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Http\Support\Json;
use App\Models\Workflow\ApprovalRequest;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin ApprovalRequest */
final class ApprovalRequestResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'document_type' => $this->document_type,
            'document_id' => $this->document_id,
            'step' => $this->step,
            'slot' => $this->slot,
            'role' => $this->role,
            'requested_by' => $this->requested_by,
            'requested_by_name' => $this->requester?->name,
            'requested_at' => Json::time($this->requested_at),
            'document' => $this->document($request),
        ];
    }

    /** @return array<string, mixed> */
    private function document(Request $request): array
    {
        $amount = Json::money((int) $this->getAttribute('document_amount'), Json::baseCurrency($request));
        $invoice = $this->invoice;
        if ($invoice !== null) {
            return [
                'id' => $invoice->id,
                'kind' => $invoice->kind->value,
                'number' => $invoice->number,
                'issue_date' => Json::date($invoice->issue_date),
                'contact_id' => $invoice->contact_id,
                'reference' => $invoice->reference,
                'memo' => $invoice->memo,
                'amount' => $amount,
                'created_by' => $invoice->created_by,
                'submitted_by' => $invoice->submitted_by,
                'version' => $invoice->lock_version,
            ];
        }
        $settlement = $this->settlement;
        if ($settlement !== null) {
            return [
                'id' => $settlement->id,
                'kind' => $settlement->kind,
                'number' => $settlement->number,
                'settlement_date' => Json::date($settlement->settlement_date),
                'contact_id' => $settlement->contact_id,
                'reference' => $settlement->reference,
                'memo' => $settlement->memo,
                'amount' => $amount,
                'created_by' => $settlement->created_by,
                'submitted_by' => $settlement->submitted_by,
                'version' => $settlement->lock_version,
            ];
        }
        $run = $this->paymentRun;
        if ($run !== null) {
            return [
                'id' => $run->id,
                'number' => $run->number,
                'run_date' => Json::date($run->run_date),
                'reference' => $run->reference,
                'memo' => $run->memo,
                'amount' => $amount,
                'created_by' => $run->created_by,
                'submitted_by' => $run->submitted_by,
                'version' => $run->lock_version,
            ];
        }
        $provision = $this->provisionRun;
        if ($provision !== null) {
            return [
                'id' => $provision->id,
                'number' => $provision->number,
                'as_of' => Json::date($provision->as_of),
                'memo' => $provision->memo,
                'amount' => $amount,
                'created_by' => $provision->created_by,
                'submitted_by' => $provision->submitted_by,
                'version' => $provision->lock_version,
            ];
        }
        $writeOff = $this->writeOff;
        if ($writeOff !== null) {
            return [
                'id' => $writeOff->id,
                'number' => $writeOff->number,
                'write_off_date' => Json::date($writeOff->write_off_date),
                'contact_id' => $writeOff->contact_id,
                'reference' => $writeOff->reference,
                'memo' => $writeOff->reason,
                'amount' => $amount,
                'created_by' => $writeOff->created_by,
                'submitted_by' => $writeOff->submitted_by,
                'version' => $writeOff->lock_version,
            ];
        }
        $transfer = $this->fundTransfer;
        if ($transfer !== null) {
            return [
                'id' => $transfer->id,
                'number' => $transfer->number,
                'send_date' => Json::date($transfer->send_date),
                'reference' => $transfer->reference,
                'memo' => $transfer->memo,
                'amount' => $amount,
                'created_by' => $transfer->created_by,
                'submitted_by' => $transfer->submitted_by,
                'version' => $transfer->lock_version,
            ];
        }
        $assetTx = $this->assetTransaction;
        if ($assetTx !== null) {
            return [
                'id' => $assetTx->id,
                'kind' => $assetTx->kind,
                'number' => $assetTx->number,
                'tx_date' => Json::date($assetTx->tx_date),
                'memo' => $assetTx->reason,
                'amount' => $amount,
                'created_by' => $assetTx->created_by,
                'submitted_by' => $assetTx->submitted_by,
                'version' => $assetTx->lock_version,
            ];
        }
        $depreciation = $this->depreciationRun;
        if ($depreciation !== null) {
            return [
                'id' => $depreciation->id,
                'number' => $depreciation->number,
                'as_of' => Json::date($depreciation->as_of),
                'memo' => $depreciation->memo,
                'amount' => $amount,
                'created_by' => $depreciation->created_by,
                'submitted_by' => $depreciation->submitted_by,
                'version' => $depreciation->lock_version,
            ];
        }
        $requisition = $this->purchaseRequisition;
        if ($requisition !== null) {
            return [
                'id' => $requisition->id,
                'number' => $requisition->number,
                'requisition_date' => Json::date($requisition->requisition_date),
                'memo' => $requisition->memo,
                'amount' => $amount,
                'created_by' => $requisition->created_by,
                'submitted_by' => $requisition->submitted_by,
                'version' => $requisition->lock_version,
            ];
        }
        $order = $this->purchaseOrder;
        if ($order !== null) {
            return [
                'id' => $order->id,
                'number' => $order->number,
                'order_date' => Json::date($order->order_date),
                'contact_id' => $order->contact_id,
                'reference' => $order->reference,
                'memo' => $order->memo,
                'amount' => $amount,
                'created_by' => $order->created_by,
                'submitted_by' => $order->submitted_by,
                'version' => $order->lock_version,
            ];
        }
        $revision = $this->orderRevision;
        if ($revision !== null) {
            return [
                'id' => $revision->id,
                'purchase_order_id' => $revision->purchase_order_id,
                'number' => $revision->order->number,
                'order_date' => Json::date($revision->order->order_date),
                'contact_id' => $revision->order->contact_id,
                'memo' => $revision->reason,
                'amount' => $amount,
                'created_by' => $revision->created_by,
                'submitted_by' => $revision->submitted_by,
                'version' => $revision->lock_version,
            ];
        }
        $journal = $this->journal;

        return [
            'id' => $journal->id,
            'journal_type' => $journal->journal_type->value,
            'journal_date' => Json::date($journal->journal_date),
            'reference' => $journal->reference,
            'memo' => $journal->memo,
            'amount' => $amount,
            'created_by' => $journal->created_by,
            'submitted_by' => $journal->submitted_by,
            'version' => $journal->lock_version,
        ];
    }
}
