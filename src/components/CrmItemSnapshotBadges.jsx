import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const formatQty = (value) => new Intl.NumberFormat('cs-CZ', {
  maximumFractionDigits: 3,
}).format(Number(value || 0));

const productTypeLabel = (type) => {
  if (type === 'manufactured') return 'Sklad';
  if (type === 'service') return 'Služba';
  return null;
};

export const CrmItemSnapshotBadges = ({ item, className }) => {
  const type = item?.product_type || null;
  const typeLabel = productTypeLabel(type);
  const hasStockSnapshot = item?.stock_available_snapshot !== null && item?.stock_available_snapshot !== undefined;
  const available = Number(item?.stock_available_snapshot || 0);
  const quantity = Number(item?.quantity || 0);
  const isStockLimited = type === 'manufactured' && hasStockSnapshot && quantity > available;

  if (!typeLabel && !hasStockSnapshot && !item?.catalog_price_snapshot) return null;

  return (
    <div className={cn('mt-1 flex flex-wrap items-center gap-1.5 text-xs', className)}>
      {typeLabel && (
        <Badge variant="outline" className="h-5 border-slate-200 bg-slate-50 px-1.5 text-[11px] font-medium text-slate-600">
          {typeLabel}
        </Badge>
      )}
      {hasStockSnapshot && type === 'manufactured' && (
        <Badge
          variant="outline"
          className={cn(
            'h-5 px-1.5 text-[11px] font-medium',
            isStockLimited
              ? 'border-rose-200 bg-rose-50 text-rose-700'
              : 'border-emerald-200 bg-emerald-50 text-emerald-700',
          )}
        >
          {isStockLimited && <AlertTriangle className="mr-1 h-3 w-3" />}
          Skladem {formatQty(available)}
        </Badge>
      )}
      {item?.catalog_price_snapshot !== null && item?.catalog_price_snapshot !== undefined && (
        <Badge variant="outline" className="h-5 border-blue-200 bg-blue-50 px-1.5 text-[11px] font-medium text-blue-700">
          Katalog {formatQty(item.catalog_price_snapshot)} Kč
        </Badge>
      )}
    </div>
  );
};

export const CrmCatalogProductMeta = ({ product }) => {
  const item = {
    product_type: product?.product_type,
    stock_available_snapshot: product?.available_qty,
    catalog_price_snapshot: product?.default_unit_price,
    quantity: 0,
  };

  return <CrmItemSnapshotBadges item={item} className="mt-0" />;
};

export default CrmItemSnapshotBadges;

