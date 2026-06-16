import React, { useState } from 'react';
import { format } from 'date-fns';
import { cs } from 'date-fns/locale';
import {
  Check,
  CheckCircle,
  Download,
  Edit2,
  Eye,
  FileWarning,
  Loader2,
  MoreHorizontal,
  Trash2,
  Upload,
  XCircle
} from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import PayoutApprovalAuditLog from './PayoutApprovalAuditLog';
import { formatCurrency, PayoutStatusBadge } from '@/components/payouts/PayoutShared';
import PayoutRequestsTable from '@/components/payouts/PayoutRequestsTable';

const PayoutTableActions = ({
  item,
  canAdmin,
  onApproveWithDialog,
  onDelete,
  onDownloadInvoice,
  onEdit,
  onUpdateStatus,
  onUploadInvoice
}) => {
  const { user } = useAuth();
  const [isUploading, setIsUploading] = useState(false);
  const fileInputId = `payout-invoice-${item.id}`;
  const isOwner = user?.id === item.members?.auth_user_id;
  const canUploadInvoice = item.status === 'approved' && isOwner && !item.approved_without_invoice && !item.invoice_url;
  const canMarkPaid = canAdmin && (item.status === 'invoice_uploaded' || (item.status === 'approved' && item.approved_without_invoice));
  const canManagePending = canAdmin && item.status === 'pending';
  const canEditPending = item.status === 'pending' && (canAdmin || isOwner);
  const canDeleteRequest = canAdmin || (item.status === 'pending' && isOwner);

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
      await onUploadInvoice?.(item, file);
      event.target.value = '';
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {canManagePending && (
        <>
          <Button
            size="sm"
            variant="outline"
            className="h-8 border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
            onClick={() => onApproveWithDialog?.(item)}
          >
            <CheckCircle className="mr-1 h-4 w-4" />
            Schválit
          </Button>
          <Button
            size="icon"
            variant="outline"
            className="h-8 w-8 border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
            onClick={() => onUpdateStatus?.(item.id, 'rejected', item)}
            title="Zamítnout"
          >
            <XCircle className="h-4 w-4" />
          </Button>
        </>
      )}

      {canUploadInvoice && (
        <>
          <input
            id={fileInputId}
            type="file"
            className="hidden"
            accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
            onChange={handleFileChange}
          />
          <Button
            size="sm"
            variant="outline"
            className="h-8 border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
            disabled={isUploading}
            onClick={() => document.getElementById(fileInputId)?.click()}
          >
            {isUploading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Upload className="mr-1 h-4 w-4" />}
            Faktura
          </Button>
        </>
      )}

      {canMarkPaid && (
        <Button
          size="sm"
          className="h-8 bg-emerald-600 text-white hover:bg-emerald-700"
          onClick={() => onUpdateStatus?.(item.id, 'paid', item)}
        >
          <Check className="mr-1 h-4 w-4" />
          Vyplatit
        </Button>
      )}

      {(canEditPending || canDeleteRequest) && (
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-500 hover:bg-slate-100 hover:text-slate-950" title="Další akce">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-44 p-1.5" align="end">
            {canEditPending && (
              <Button variant="ghost" size="sm" className="w-full justify-start gap-2" onClick={() => onEdit?.(item)}>
                <Edit2 className="h-4 w-4 text-slate-400" />
                Upravit
              </Button>
            )}
            {canDeleteRequest && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="sm" className="w-full justify-start gap-2 text-red-600 hover:bg-red-50 hover:text-red-700">
                    <Trash2 className="h-4 w-4" />
                    Smazat
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Smazat žádost o výplatu?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Žádost bude trvale odstraněna včetně všech položek. Vlastní žádosti lze mazat jen dokud čekají na schválení.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Zrušit</AlertDialogCancel>
                    <AlertDialogAction className="bg-red-600 text-white hover:bg-red-700" onClick={() => onDelete?.(item.id)}>
                      Smazat
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
};

const getPayoutItemTitle = (item) => item.projects?.name || item.realizations?.name || 'Položka výplaty';
const getPayoutItemSubtitle = (item) => {
  if (item.projects?.code) return item.projects.code;
  if (item.realization_id) return 'Realizace';
  return 'Projekt';
};

const PayoutItemsSummary = ({ items = [] }) => {
  if (!items.length) return <span className="text-sm text-slate-400">Bez položek</span>;

  const visibleItems = items.slice(0, 3);

  return (
    <div className="space-y-2">
      {visibleItems.map((payoutItem) => (
        <div key={payoutItem.id} className="rounded-lg border border-slate-100 bg-slate-50/70 px-3 py-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-slate-800">{getPayoutItemTitle(payoutItem)}</div>
              <div className="mt-0.5 text-xs text-slate-500">{getPayoutItemSubtitle(payoutItem)}</div>
            </div>
            <div className="shrink-0 text-right text-sm font-semibold tabular-nums text-slate-950">
              {formatCurrency(payoutItem.amount)}
            </div>
          </div>
        </div>
      ))}
      {items.length > visibleItems.length && (
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="link" className="h-auto p-0 text-xs font-medium text-slate-600">
              Zobrazit všech {items.length} položek
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-96 p-0" align="start">
            <div className="border-b bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-950">Obsah žádosti</div>
            <div className="max-h-80 space-y-2 overflow-y-auto p-3">
              {items.map((payoutItem) => (
                <div key={payoutItem.id} className="rounded-lg border px-3 py-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="break-words text-sm font-medium text-slate-900">{getPayoutItemTitle(payoutItem)}</div>
                      <div className="mt-0.5 text-xs text-slate-500">{getPayoutItemSubtitle(payoutItem)}</div>
                    </div>
                    <div className="shrink-0 text-sm font-semibold tabular-nums text-slate-950">{formatCurrency(payoutItem.amount)}</div>
                  </div>
                </div>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
};

const PayoutTable = ({
  canAdmin,
  data,
  loading,
  onApproveWithDialog,
  onDelete,
  onDownloadInvoice,
  onEdit,
  onUpdateStatus,
  onUploadInvoice
}) => {
  const [selectedAuditPayout, setSelectedAuditPayout] = useState(null);

  const columns = [
    {
      key: 'date',
      header: 'Datum',
      headerClassName: 'h-11 px-5 text-xs font-bold uppercase tracking-wide text-slate-500',
      cellClassName: 'px-5 font-medium text-slate-600',
      render: (item) => format(new Date(item.created_at || item.request_date), 'dd. MM. yyyy', { locale: cs }),
    },
    {
      key: 'worker',
      header: 'Pracovník',
      render: (item) => (
        <>
          <div className="font-semibold text-slate-950">{item.members?.name || 'Neznámý pracovník'}</div>
          {item.variable_symbol && <div className="mt-0.5 text-xs text-slate-500">VS {item.variable_symbol}</div>}
        </>
      ),
    },
    {
      key: 'items',
      header: 'Položky',
      cellClassName: 'min-w-[320px] max-w-[460px]',
      render: (item) => <PayoutItemsSummary items={item.payout_items || []} />,
    },
    {
      key: 'amount',
      header: 'Částka',
      headerClassName: 'h-11 text-right text-xs font-bold uppercase tracking-wide text-slate-500',
      cellClassName: 'text-right',
      render: (item) => <div className="font-bold tabular-nums text-slate-950">{formatCurrency(item.total_amount || item.amount)}</div>,
    },
    {
      key: 'status',
      header: 'Stav',
      render: (item) => (
        <div className="flex flex-col items-start gap-1">
          <PayoutStatusBadge status={item.status} />
          {item.approved_without_invoice && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="outline" className="h-7 cursor-help gap-1.5 rounded-full border-amber-200 bg-amber-50 px-2.5 text-amber-700">
                    <FileWarning className="h-3.5 w-3.5" />
                    Bez faktury
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>Tato výplata byla schválena bez nutnosti přiložit fakturu.</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      ),
    },
    {
      key: 'invoice',
      header: 'Faktura',
      render: (item) => (
        <div className="space-y-2">
          {item.invoice_url ? (
            <Button variant="outline" size="sm" onClick={() => onDownloadInvoice?.(item.invoice_url, item.invoice_name)} className="h-8 gap-2 border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100">
              <Download className="h-3.5 w-3.5" />
              Stáhnout
            </Button>
          ) : (
            <span className="text-xs text-slate-400">Faktura zatím není nahraná</span>
          )}
          {item.admin_note && (
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="link" className="h-auto p-0 text-xs text-slate-600">Poznámka administrátora</Button>
              </PopoverTrigger>
              <PopoverContent className="w-80 text-sm">
                <div className="mb-1 font-semibold text-slate-950">Poznámka</div>
                <p className="text-slate-600">{item.admin_note}</p>
              </PopoverContent>
            </Popover>
          )}
        </div>
      ),
    },
    {
      key: 'actions',
      header: 'Akce',
      headerClassName: 'h-11 px-5 text-right text-xs font-bold uppercase tracking-wide text-slate-500',
      cellClassName: 'px-5 text-right',
      render: (item) => (
        <div className="flex items-center justify-end gap-2">
          <Popover open={selectedAuditPayout === item.id} onOpenChange={(open) => setSelectedAuditPayout(open ? item.id : null)}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-500 hover:bg-slate-100 hover:text-slate-950" title="Historie schválení">
                <Eye className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-96 p-0" align="end">
              <div className="flex items-center gap-2 border-b bg-slate-50 p-4 font-semibold text-slate-950">
                <Eye className="h-4 w-4 text-primary" />
                Historie schválení
              </div>
              <div className="max-h-[300px] overflow-y-auto p-4">
                <PayoutApprovalAuditLog payoutId={item.id} />
              </div>
            </PopoverContent>
          </Popover>
          <PayoutTableActions
            item={item}
            canAdmin={canAdmin}
            onApproveWithDialog={onApproveWithDialog}
            onDelete={onDelete}
            onDownloadInvoice={onDownloadInvoice}
            onEdit={onEdit}
            onUpdateStatus={onUpdateStatus}
            onUploadInvoice={onUploadInvoice}
          />
        </div>
      ),
    },
  ];

  return (
    <PayoutRequestsTable
      columns={columns}
      emptyDescription="Aktuální filtry nevrátily žádný záznam."
      emptyTitle="Žádné úkolové žádosti"
      getRowKey={(item) => item.id}
      items={data}
      loading={loading}
      loadingLabel="Načítám úkolové výplaty..."
    />
  );
};

export default PayoutTable;
