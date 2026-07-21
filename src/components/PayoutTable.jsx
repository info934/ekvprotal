import React, { useState } from 'react';
import { format } from 'date-fns';
import { cs } from 'date-fns/locale';
import { Link } from 'react-router-dom';
import {
  Briefcase,
  CalendarDays,
  Check,
  CheckCircle,
  ChevronDown,
  Download,
  Edit2,
  Eye,
  FileWarning,
  Hash,
  Loader2,
  MoreHorizontal,
  DollarSign,
  Trash2,
  Upload,
  User,
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
  const canUploadInvoice = item.status === 'approved' && (isOwner || canAdmin) && !item.approved_without_invoice && !item.invoice_url;
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
const getPayoutItemHref = (item) => {
  if (item.project_id) return `/projects/${item.project_id}`;
  if (item.realization_id) return `/realizace/${item.realization_id}`;
  return null;
};

const PayoutItemsSummary = ({ items = [] }) => {
  if (!items.length) return <span className="text-sm text-slate-400">Bez položek</span>;

  const visibleItems = items.slice(0, 2);
  const totalAmount = items.reduce((sum, payoutItem) => sum + Number(payoutItem.amount || 0), 0);

  return (
    <div className="min-w-0 space-y-1.5">
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <Badge variant="outline" className="rounded-full border-slate-200 bg-white font-semibold text-slate-700">
          {items.length} {items.length === 1 ? 'položka' : items.length < 5 ? 'položky' : 'položek'}
        </Badge>
        <span className="tabular-nums">Součet položek {formatCurrency(totalAmount)}</span>
      </div>
      <div className="space-y-1">
        {visibleItems.map((payoutItem) => (
          <div key={payoutItem.id} className="flex min-w-0 items-center justify-between gap-3 rounded-md border border-slate-100 bg-slate-50/70 px-2.5 py-1.5">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-slate-800">{getPayoutItemTitle(payoutItem)}</div>
              <div className="text-xs text-slate-500">{getPayoutItemSubtitle(payoutItem)}</div>
            </div>
            <div className="shrink-0 text-right text-sm font-semibold tabular-nums text-slate-950">
              {formatCurrency(payoutItem.amount)}
            </div>
          </div>
        ))}
      </div>
      {items.length > visibleItems.length && (
        <div className="text-xs font-medium text-slate-500">Další položky jsou v detailu žádosti.</div>
      )}
    </div>
  );
};

const DetailMetric = ({ icon: Icon, label, value }) => (
  <div className="rounded-lg border border-slate-200 bg-white p-3">
    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
      <Icon className="h-3.5 w-3.5" />
      {label}
    </div>
    <div className="mt-1.5 break-words text-sm font-semibold text-slate-950">{value}</div>
  </div>
);

const PayoutDetailPanel = ({ item, onDownloadInvoice }) => {
  const payoutItems = item.payout_items || [];
  const createdAt = item.created_at || item.request_date;
  const approvedAt = item.approved_at;
  const paidAt = item.paid_at;

  return (
    <div className="py-4">
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="grid gap-3 border-b border-slate-200 p-4 sm:grid-cols-2 xl:grid-cols-4">
          <DetailMetric icon={User} label="Pracovník" value={item.members?.name || 'Neznámý pracovník'} />
          <DetailMetric icon={Hash} label="Variabilní symbol" value={item.variable_symbol || 'Není vyplněn'} />
          <DetailMetric icon={CalendarDays} label="Podáno" value={createdAt ? format(new Date(createdAt), 'd. MMMM yyyy', { locale: cs }) : 'Bez data'} />
          <DetailMetric icon={DollarSign} label="Celkem" value={formatCurrency(item.total_amount || item.amount)} />
        </div>

        <div className="grid gap-5 p-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0">
            <div className="mb-3 flex items-center gap-2">
              <Briefcase className="h-4 w-4 text-slate-500" />
              <h3 className="text-sm font-semibold text-slate-950">Položky úkolové mzdy</h3>
            </div>
            {payoutItems.length ? (
              <div className="overflow-hidden rounded-lg border border-slate-200">
                <div className="grid grid-cols-[minmax(0,1fr)_140px] bg-slate-50 px-3 py-2 text-xs font-bold uppercase tracking-wide text-slate-500">
                  <div>Projekt / realizace</div>
                  <div className="text-right">Částka</div>
                </div>
                <div className="divide-y divide-slate-100">
                  {payoutItems.map((payoutItem) => {
                    const href = getPayoutItemHref(payoutItem);
                    const title = getPayoutItemTitle(payoutItem);

                    return (
                      <div key={payoutItem.id} className="grid grid-cols-[minmax(0,1fr)_140px] gap-3 px-3 py-2.5">
                        <div className="min-w-0">
                          {href ? (
                            <Link to={href} className="break-words text-sm font-semibold text-slate-900 hover:text-primary">
                              {title}
                            </Link>
                          ) : (
                            <div className="break-words text-sm font-semibold text-slate-900">{title}</div>
                          )}
                          <div className="mt-0.5 text-xs text-slate-500">{getPayoutItemSubtitle(payoutItem)}</div>
                        </div>
                        <div className="text-right text-sm font-bold tabular-nums text-slate-950">{formatCurrency(payoutItem.amount)}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-slate-300 p-5 text-sm text-slate-500">Žádost nemá rozepsané položky.</div>
            )}
          </div>

          <div className="space-y-4">
            <div>
              <h3 className="mb-2 text-sm font-semibold text-slate-950">Stav a fakturace</h3>
              <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/70 p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-slate-500">Aktuální stav</span>
                  <PayoutStatusBadge status={item.status} />
                </div>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-slate-500">Schváleno</span>
                  <span className="font-medium text-slate-900">{approvedAt ? format(new Date(approvedAt), 'd. M. yyyy', { locale: cs }) : 'Zatím ne'}</span>
                </div>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-slate-500">Vyplaceno</span>
                  <span className="font-medium text-slate-900">{paidAt ? format(new Date(paidAt), 'd. M. yyyy', { locale: cs }) : 'Zatím ne'}</span>
                </div>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-slate-500">Režim faktury</span>
                  <span className="font-medium text-slate-900">{item.approved_without_invoice ? 'Bez faktury' : 'S fakturou'}</span>
                </div>
                {item.invoice_url ? (
                  <Button variant="outline" size="sm" onClick={() => onDownloadInvoice?.(item)} className="mt-2 w-full justify-center gap-2 border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100">
                    <Download className="h-3.5 w-3.5" />
                    Stáhnout fakturu
                  </Button>
                ) : (
                  <div className="mt-2 rounded-md border border-dashed border-slate-300 bg-white px-3 py-2 text-xs text-slate-500">Faktura zatím není nahraná.</div>
                )}
              </div>
            </div>

            {item.admin_note && (
              <div>
                <h3 className="mb-2 text-sm font-semibold text-slate-950">Poznámka administrátora</h3>
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-950">{item.admin_note}</div>
              </div>
            )}
          </div>
        </div>
      </div>
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
  const [expandedPayout, setExpandedPayout] = useState(null);
  const togglePayoutDetail = (item) => {
    setExpandedPayout((current) => (current === item.id ? null : item.id));
  };

  const columns = [
    {
      key: 'expand',
      header: '',
      headerClassName: 'h-11 w-12 px-4',
      cellClassName: 'w-12 px-4',
      render: (item) => {
        const isExpanded = expandedPayout === item.id;

        return (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-slate-500 hover:bg-slate-100 hover:text-slate-950"
            onClick={() => togglePayoutDetail(item)}
            title={isExpanded ? 'Sbalit detail' : 'Zobrazit detail'}
          >
            <ChevronDown className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
          </Button>
        );
      },
    },
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
            <Button variant="outline" size="sm" onClick={() => onDownloadInvoice?.(item)} className="h-8 gap-2 border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100">
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
      getRowAriaLabel={(item) => {
        const worker = item.members?.name || 'neznámý pracovník';
        const action = expandedPayout === item.id ? 'Sbalit detail žádosti' : 'Zobrazit detail žádosti';
        return `${action}: ${worker}, ${formatCurrency(item.total_amount || item.amount)}`;
      }}
      getRowKey={(item) => item.id}
      items={data}
      loading={loading}
      loadingLabel="Načítám úkolové výplaty..."
      onRowClick={togglePayoutDetail}
      renderExpandedRow={(item) => (
        expandedPayout === item.id ? <PayoutDetailPanel item={item} onDownloadInvoice={onDownloadInvoice} /> : null
      )}
    />
  );
};

export default PayoutTable;
