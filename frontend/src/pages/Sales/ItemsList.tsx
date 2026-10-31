import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLedgerStore } from '@/mock/store';
import { DataTable } from '@/components/domain/DataTable';
import { SplitPane } from '@/components/domain/SplitPane';
import { ColumnDef } from '@tanstack/react-table';
import { formatMoney } from '@/lib/format';
import { Plus, Download, Tag, FileText, Eye, Pencil, Copy, Archive } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/domain/PageHeader';
import { QuickCreateItemDialog } from '@/components/domain/QuickCreateItemDialog';
import type { Item } from '@/types';

export type ItemRecord = Item;

export const ItemsList: React.FC = () => {
  const navigate = useNavigate();
  const { currentCompany, uiDensity, items, updateItem } = useLedgerStore();
  const [newItemOpen, setNewItemOpen] = useState(false);
  const coSlug = currentCompany.slug;

  const [selectedItemId, setSelectedItemId] = useState<string | null>(items[0]?.id || null);

  const selectedItem = useMemo(() => {
    return items.find((i) => i.id === selectedItemId) || null;
  }, [items, selectedItemId]);

  const columns: ColumnDef<ItemRecord>[] = [
    {
      accessorKey: 'sku',
      header: 'SKU / Code',
      cell: ({ row }) => (
        <span className="font-mono font-semibold text-accent flex items-center gap-1.5">
          <Tag className="w-3.5 h-3.5 text-text-muted shrink-0" />
          {row.original.sku}
        </span>
      ),
    },
    {
      accessorKey: 'name',
      header: 'Item Description',
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span className="font-medium text-text-primary text-xs">{row.original.name}</span>
          <span className="text-[11px] text-text-muted capitalize">{row.original.type}</span>
        </div>
      ),
    },
    {
      accessorKey: 'sales_price',
      header: () => <div className="text-right">Sales price</div>,
      cell: ({ row }) => (
        <div className="text-right font-mono text-num font-semibold text-text-primary">
          {formatMoney(row.original.sales_price)}
        </div>
      ),
    },
    {
      accessorKey: 'purchase_price',
      header: () => <div className="text-right">Cost price</div>,
      cell: ({ row }) => (
        <div className="text-right font-mono text-num text-text-muted">
          {formatMoney(row.original.purchase_price)}
        </div>
      ),
    },
    {
      accessorKey: 'income_account',
      header: 'GL Account',
      cell: ({ row }) => (
        <span className="font-mono text-xs text-text-secondary">
          {row.original.income_account} {row.original.income_account_name}
        </span>
      ),
    },
    {
      accessorKey: 'tax_code',
      header: 'Tax code',
      cell: ({ row }) => (
        <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-surface-neutral border border-border">
          {row.original.tax_code}
        </span>
      ),
    },
    {
      accessorKey: 'is_active',
      header: 'Status',
      cell: ({ row }) => (
        <span
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${
            row.original.is_active
              ? 'bg-success-soft text-success border border-success/30'
              : 'bg-surface-neutral text-text-muted border border-border'
          }`}
        >
          {row.original.is_active ? 'Active' : 'Archived'}
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-2">
      <PageHeader
        title="Items and prices"
        subtitle={`${items.length} items you sell or buy`}
        className="px-1 pb-4"
        actions={
          <button
            type="button"
            onClick={() => setNewItemOpen(true)}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-accent hover:bg-accent-hover text-white text-[13px] font-medium transition cursor-pointer"
          >
            <Plus className="size-4" />
            <span>New item</span>
          </button>
        }
      />

      {/* 2. Resizable Split Master-Detail */}
      <SplitPane
        storageKey="ledgerly_items_split_width"
        isOpen={Boolean(selectedItem)}
        onClose={() => setSelectedItemId(null)}
        title={selectedItem?.sku || 'Item Detail'}
        detailContent={
          selectedItem && (
            <div className="flex flex-col gap-4 text-xs">
              {/* Item Details Header */}
              <div className="flex items-start justify-between pb-3 border-b border-border">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-semibold text-accent">{selectedItem.sku}</span>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                        selectedItem.is_active
                          ? 'bg-success-soft text-success border border-success/30'
                          : 'bg-surface-neutral text-text-muted border border-border'
                      }`}
                    >
                      {selectedItem.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <h2 className="text-sm font-semibold text-text-primary mt-1">
                    {selectedItem.name}
                  </h2>
                </div>
              </div>

              {/* Pricing & Margin Card */}
              <div className="grid grid-cols-2 gap-3 p-3 bg-surface-neutral rounded border border-border">
                <div>
                  <div className="text-[11px] text-text-muted">Sales price</div>
                  <div className="font-mono font-semibold text-base text-text-primary">
                    {formatMoney(selectedItem.sales_price)}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-text-muted">Standard cost</div>
                  <div className="font-mono font-semibold text-base text-text-muted">
                    {formatMoney(selectedItem.purchase_price)}
                  </div>
                </div>
                <div className="col-span-2 pt-2 border-t border-border flex justify-between items-center text-xs">
                  <span className="text-text-muted">Gross margin:</span>
                  <span className="font-mono font-semibold text-success">
                    {(
                      ((selectedItem.sales_price - selectedItem.purchase_price) /
                        selectedItem.sales_price) *
                      100
                    ).toFixed(1)}
                    % ({formatMoney(selectedItem.sales_price - selectedItem.purchase_price)})
                  </span>
                </div>
              </div>

              {/* Accounting Mapping */}
              <div className="flex flex-col gap-2.5 text-xs text-text-secondary">
                <div className="font-semibold text-text-primary text-xs border-b border-border pb-1">
                  Accounting setup
                </div>
                <div className="flex justify-between">
                  <span className="text-text-muted">Income account:</span>
                  <span className="font-mono font-semibold text-text-primary">
                    {selectedItem.income_account} ({selectedItem.income_account_name})
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-muted">Expense account:</span>
                  <span className="font-mono font-semibold text-text-primary">
                    {selectedItem.expense_account}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-muted">Default tax code:</span>
                  <span className="font-mono font-semibold text-text-primary">
                    {selectedItem.tax_code}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-muted">Units sold (2026):</span>
                  <span className="font-mono font-semibold text-text-primary">
                    {selectedItem.total_sold_qty} units
                  </span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="mt-auto pt-4 border-t border-border flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => navigate(`/${coSlug}/invoices/new`)}
                  className="flex items-center justify-center gap-1.5 h-8 px-3 rounded-md bg-accent hover:bg-accent-hover text-white text-[13px] font-medium transition cursor-pointer"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>Create invoice with this item</span>
                </button>
                <button
                  type="button"
                  onClick={() => toast.success(`Item ${selectedItem.sku} exported`)}
                  className="flex items-center justify-center gap-1.5 h-8 px-3 rounded-lg border border-border hover:bg-surface-neutral text-xs font-medium text-text-secondary cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Export item card (CSV)</span>
                </button>
              </div>
            </div>
          )
        }
      >
        <div className="flex-1 overflow-hidden">
          <DataTable
            columns={columns}
            data={items}
            searchPlaceholder="Filter items by SKU, name, or GL account..."
            rowDensity={uiDensity}
            contextMenuTitle={(r) => `${r.sku}`}
            rowActions={(r) => [
              { label: 'View details', icon: Eye, shortcut: 'Enter', onClick: () => setSelectedItemId(r.id) },
              { label: 'Edit price', icon: Pencil, onClick: () => toast.info(`Editing ${r.name}`) },
              { label: 'Duplicate', icon: Copy, onClick: () => toast.success(`Copy of ${r.name} created as a draft`) },
              {
                label: 'Archive',
                icon: Archive,
                destructive: true,
                disabled: !r.is_active,
                disabledReason: 'Already archived',
                onClick: () => {
                  updateItem(r.id, { is_active: false });
                  toast.success(`${r.name} archived`, {
                    action: { label: 'Undo', onClick: () => updateItem(r.id, { is_active: true }) },
                  });
                },
              },
            ]}
            onRowClick={(row) => setSelectedItemId(row.id)}
            onRowDoubleClick={(row) => toast.info(`Viewing ${row.sku}`)}
          />
        </div>
      </SplitPane>
    
      <QuickCreateItemDialog
        open={newItemOpen}
        onOpenChange={setNewItemOpen}
        onCreated={(it) => setSelectedItemId(it.id)}
      />
    </div>
  );
};
