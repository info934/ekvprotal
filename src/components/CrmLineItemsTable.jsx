import React, { useMemo, useState } from 'react';
import { AlertTriangle, PackageSearch, Plus, Target, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  CRM_VAT_RATE_OPTIONS,
  calculateCrmItem,
  calculateCrmItemTotals,
  calculateUnitPriceForMargin,
} from '@/lib/crmItemPayloads';
import { formatMoney } from '@/lib/financePresentation';

const text = {
  defaultTitle: 'Položkový seznam',
  defaultDescription: 'Položky používají jednotný výpočet ceny, DPH, slevy, marže a provize.',
  addFromCatalog: 'Přidat z katalogu',
  manualItem: 'Ruční položka',
  globalMargin: 'Globální marže',
  globalCommission: 'Globální provize',
  targetMargin: 'Cílová marže %',
  targetCommission: 'Provize %',
  applyMargin: 'Nastavit marži',
  applyCommission: 'Nastavit provizi',
  code: 'Kód',
  codeLocked: 'Kód se mění jen v detailu produktu',
  nameDescription: 'Název a popis',
  quantity: 'Množství',
  unit: 'MJ',
  purchase: 'Nákup',
  sale: 'Prodej',
  itemMargin: 'Marže %',
  discount: 'Sleva %',
  vat: 'DPH',
  subtotal: 'Bez DPH',
  margin: 'Marže',
  commission: 'Provize',
  profitAfterCommission: 'Zisk po provizi',
  totalWithTax: 'S DPH',
  empty: 'Zatím bez položek.',
  itemDescription: 'Popis položky',
  beforeDiscount: 'Cena před slevou',
  totalDiscount: 'Celková sleva',
  withoutVat: 'Cena bez DPH',
  vatSummary: 'DPH',
  costs: 'Náklady',
};

const formatCurrency = formatMoney;

const numericFields = new Set([
  'quantity',
  'unit_price',
  'unit_cost',
  'purchase_price_snapshot',
  'discount_percent',
  'vat_rate',
  'commission_percent',
]);

const getRowKey = (item, index) => item.id || item.catalog_item_id || `${item.code || 'item'}-${index}`;

const normalizePercent = (value) => Math.min(95, Math.max(-100, Number(value || 0)));
const normalizeCommissionPercent = (value) => Math.min(100, Math.max(0, Number(value || 0)));

const CrmLineItemsTable = ({
  title = text.defaultTitle,
  description = text.defaultDescription,
  items = [],
  canEdit = false,
  disabled = false,
  onUpdateItem,
  onRemoveItem,
  onAddManual,
  onOpenCatalog,
  showFinancials = true,
}) => {
  const totals = calculateCrmItemTotals(items);
  const isDisabled = disabled || !canEdit;
  const [globalMargin, setGlobalMargin] = useState(() => Number(totals.margin_percent || 0).toFixed(1));
  const [globalCommission, setGlobalCommission] = useState(() => Number(0).toFixed(1));

  const marginSummary = useMemo(() => ({
    current: Number(totals.margin_percent || 0),
    value: Number(totals.margin_total || 0),
  }), [totals.margin_percent, totals.margin_total]);
  const lowMarginCount = useMemo(() => items.filter((item) => (
    item.included_in_total !== false && calculateCrmItem(item).marginPercent < 15
  )).length, [items]);

  const handleChange = (item, index, field, rawValue) => {
    const value = numericFields.has(field) ? Number(rawValue || 0) : rawValue;
    onUpdateItem?.(item.id, field, value, index);
  };

  const handleItemMarginChange = (item, index, rawValue) => {
    const unitPrice = calculateUnitPriceForMargin(item, rawValue);
    onUpdateItem?.(item.id, 'unit_price', unitPrice, index);
  };

  const handleApplyGlobalMargin = () => {
    const targetMargin = normalizePercent(globalMargin);
    items.forEach((item, index) => {
      const unitPrice = calculateUnitPriceForMargin(item, targetMargin);
      onUpdateItem?.(item.id, 'unit_price', unitPrice, index);
    });
  };

  const handleApplyGlobalCommission = () => {
    const targetCommission = normalizeCommissionPercent(globalCommission);
    items.forEach((item, index) => {
      onUpdateItem?.(item.id, 'commission_percent', targetCommission, index);
    });
  };

  return (
    <Card className="crm-panel">
      <CardHeader className="crm-panel-header">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <PackageSearch className="h-4 w-4 text-primary" />
              {title}
            </CardTitle>
            {description && <CardDescription>{description}</CardDescription>}
            {showFinancials && lowMarginCount > 0 && <div className="mt-3 flex w-fit items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900"><AlertTriangle className="h-4 w-4" />{lowMarginCount} {lowMarginCount === 1 ? 'položka má' : 'položky mají'} marži pod 15 %.</div>}
          </div>
          <div className="flex flex-col gap-2 lg:items-end">
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" className="h-8 px-2.5 text-xs" onClick={onOpenCatalog} disabled={isDisabled}>
                <Plus className="mr-2 h-4 w-4" />
                {text.addFromCatalog}
              </Button>
              <Button type="button" variant="secondary" size="sm" className="h-8 px-2.5 text-xs" onClick={onAddManual} disabled={isDisabled}>
                {text.manualItem}
              </Button>
            </div>
            {showFinancials && <div className="grid gap-2 rounded-md border bg-white p-2 shadow-sm md:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-[11px] font-semibold uppercase text-slate-500">{text.globalMargin}</Label>
                <div className="flex items-center gap-2">
                  <Input
                    className="h-8 w-24 text-right text-sm"
                    type="number"
                    step="0.1"
                    value={globalMargin}
                    onChange={(event) => setGlobalMargin(event.target.value)}
                    disabled={isDisabled || items.length === 0}
                    aria-label={text.targetMargin}
                  />
                  <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={handleApplyGlobalMargin} disabled={isDisabled || items.length === 0}>
                    <Target className="mr-1.5 h-3.5 w-3.5" />
                    {text.applyMargin}
                  </Button>
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] font-semibold uppercase text-slate-500">{text.globalCommission}</Label>
                <div className="flex items-center gap-2">
                  <Input
                    className="h-8 w-24 text-right text-sm"
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    value={globalCommission}
                    onChange={(event) => setGlobalCommission(event.target.value)}
                    disabled={isDisabled || items.length === 0}
                    aria-label={text.targetCommission}
                  />
                  <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={handleApplyGlobalCommission} disabled={isDisabled || items.length === 0}>
                    {text.applyCommission}
                  </Button>
                </div>
              </div>
              <div className="text-xs text-muted-foreground md:col-span-2 md:text-right">
                <span>{text.margin}: <strong className="text-slate-900">{marginSummary.current.toFixed(1)} %</strong></span>
                <span className="mx-2 text-slate-300">/</span>
                <span>{formatCurrency(marginSummary.value)}</span>
              </div>
            </div>}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="crm-table-wrap">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[105px]">{text.code}</TableHead>
                <TableHead className="min-w-[260px] max-w-[340px]">{text.nameDescription}</TableHead>
                <TableHead className="min-w-[90px] text-right">{text.quantity}</TableHead>
                <TableHead className="min-w-[70px]">{text.unit}</TableHead>
                {showFinancials && <TableHead className="min-w-[105px] text-right">{text.purchase}</TableHead>}
                <TableHead className="min-w-[105px] text-right">{text.sale}</TableHead>
                {showFinancials && <TableHead className="min-w-[90px] text-right">{text.itemMargin}</TableHead>}
                <TableHead className="min-w-[85px] text-right">{text.discount}</TableHead>
                <TableHead className="min-w-[95px] text-right">{text.vat}</TableHead>
                <TableHead className="min-w-[110px] text-right">{text.subtotal}</TableHead>
                {showFinancials && <TableHead className="min-w-[120px] text-right">{text.margin}</TableHead>}
                {showFinancials && <TableHead className="min-w-[95px] text-right">{text.commission}</TableHead>}
                {showFinancials && <TableHead className="min-w-[130px] text-right">{text.profitAfterCommission}</TableHead>}
                <TableHead className="min-w-[115px] text-right">{text.totalWithTax}</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={showFinancials ? 15 : 10} className="h-24 text-center text-muted-foreground">{text.empty}</TableCell>
                </TableRow>
              ) : items.map((item, index) => {
                const calculation = calculateCrmItem(item);
                const rowKey = getRowKey(item, index);
                return (
                  <TableRow key={rowKey}>
                    <TableCell>
                      <div className="rounded-md border bg-slate-50 px-2 py-1.5 font-mono text-xs font-semibold text-slate-700" title={text.codeLocked}>
                        {item.code || 'bez kódu'}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <Input value={item.name || ''} onChange={(event) => handleChange(item, index, 'name', event.target.value)} disabled={isDisabled} />
                        <Input value={item.description || ''} onChange={(event) => handleChange(item, index, 'description', event.target.value)} placeholder={text.itemDescription} className="h-8 text-xs" disabled={isDisabled} />
                        <div className="grid grid-cols-2 gap-1.5">
                          <Input value={item.section_name || ''} onChange={(event) => handleChange(item, index, 'section_name', event.target.value)} placeholder="Sekce / etapa" className="h-8 text-xs" disabled={isDisabled} />
                          <Select value={item.item_kind || 'standard'} onValueChange={(value) => handleChange(item, index, 'item_kind', value)} disabled={isDisabled}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent><SelectItem value="standard">Standardní</SelectItem><SelectItem value="optional">Volitelná</SelectItem><SelectItem value="alternative">Alternativa</SelectItem></SelectContent>
                          </Select>
                        </div>
                        {item.item_kind === 'alternative' && <Input value={item.alternative_group || ''} onChange={(event) => handleChange(item, index, 'alternative_group', event.target.value)} placeholder="Skupina alternativ" className="h-8 text-xs" disabled={isDisabled} />}
                        {item.item_kind !== 'standard' && <label className="flex items-center gap-2 text-xs text-slate-600"><Checkbox checked={item.included_in_total !== false} onCheckedChange={(value) => handleChange(item, index, 'included_in_total', value === true)} disabled={isDisabled} />Zahrnout do výsledné ceny</label>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Input className="text-right" type="number" value={item.quantity ?? 0} onChange={(event) => handleChange(item, index, 'quantity', event.target.value)} disabled={isDisabled} />
                    </TableCell>
                    <TableCell>
                      <Input value={item.unit || 'ks'} onChange={(event) => handleChange(item, index, 'unit', event.target.value)} disabled={isDisabled} />
                    </TableCell>
                    {showFinancials && <TableCell>
                      <Input className="text-right" type="number" value={item.unit_cost ?? item.purchase_price_snapshot ?? 0} onChange={(event) => handleChange(item, index, 'unit_cost', event.target.value)} disabled={isDisabled} />
                    </TableCell>}
                    <TableCell>
                      <Input className="text-right" type="number" value={item.unit_price ?? 0} onChange={(event) => handleChange(item, index, 'unit_price', event.target.value)} disabled={isDisabled} />
                    </TableCell>
                    {showFinancials && <TableCell>
                      <Input className="text-right" type="number" step="0.1" value={calculation.marginPercent.toFixed(1)} onChange={(event) => handleItemMarginChange(item, index, event.target.value)} disabled={isDisabled} />
                    </TableCell>}
                    <TableCell>
                      <Input className="text-right" type="number" value={item.discount_percent ?? 0} onChange={(event) => handleChange(item, index, 'discount_percent', event.target.value)} disabled={isDisabled} />
                    </TableCell>
                    <TableCell>
                      <Select value={String(item.vat_rate ?? 21)} onValueChange={(value) => handleChange(item, index, 'vat_rate', value)} disabled={isDisabled}>
                        <SelectTrigger className="h-9 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CRM_VAT_RATE_OPTIONS.map((rate) => (
                            <SelectItem key={rate.value} value={String(rate.value)}>{rate.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-right font-semibold">{formatCurrency(calculation.subtotal)}</TableCell>
                    {showFinancials && <TableCell className="text-right">
                      <div className="font-semibold text-emerald-700">{formatCurrency(calculation.marginAmount)}</div>
                      <div className="text-xs text-muted-foreground">{calculation.marginPercent.toFixed(1)} %</div>
                    </TableCell>}
                    {showFinancials && <TableCell>
                      <Input className="text-right" type="number" min="0" max="100" step="0.1" value={item.commission_percent ?? 0} onChange={(event) => handleChange(item, index, 'commission_percent', event.target.value)} disabled={isDisabled} />
                    </TableCell>}
                    {showFinancials && <TableCell className="text-right">
                      <div className={calculation.profitAfterCommission >= 0 ? 'font-semibold text-emerald-700' : 'font-semibold text-rose-700'}>
                        {formatCurrency(calculation.profitAfterCommission)}
                      </div>
                      <div className="text-xs text-muted-foreground">{calculation.profitAfterCommissionPercent.toFixed(1)} %</div>
                    </TableCell>}
                    <TableCell className="text-right font-semibold">{formatCurrency(calculation.totalWithTax)}</TableCell>
                    <TableCell>
                      <Button type="button" variant="ghost" size="icon" onClick={() => onRemoveItem?.(item.id, index)} disabled={isDisabled || item.id === 'fallback'}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        <div className="grid gap-2 border-t bg-slate-50 p-4 text-sm md:ml-auto md:w-[560px]">
          <div className="flex justify-between gap-4"><span>{text.beforeDiscount}</span><strong>{formatCurrency(totals.gross_subtotal)}</strong></div>
          <div className="flex justify-between gap-4"><span>{text.totalDiscount}</span><strong>{formatCurrency(totals.discount_total)}</strong></div>
          <div className="flex justify-between gap-4"><span>{text.withoutVat}</span><strong>{formatCurrency(totals.total)}</strong></div>
          <div className="flex justify-between gap-4 text-muted-foreground"><span>{text.vatSummary}</span><strong>{formatCurrency(totals.tax_total)}</strong></div>
          <div className="flex justify-between gap-4 rounded-md bg-white px-3 py-2 text-base shadow-sm"><span>{text.totalWithTax}</span><strong>{formatCurrency(totals.total_with_tax)}</strong></div>
          {showFinancials && <>
            <div className="flex justify-between gap-4 text-muted-foreground"><span>{text.costs}</span><strong>{formatCurrency(totals.cost_total)}</strong></div>
            <div className="flex justify-between gap-4 text-emerald-700"><span>{text.margin}</span><strong>{formatCurrency(totals.margin_total)} / {totals.margin_percent.toFixed(1)} %</strong></div>
            <div className="flex justify-between gap-4 text-amber-700"><span>{text.commission}</span><strong>{formatCurrency(totals.commission_total)}</strong></div>
            <div className="flex justify-between gap-4 text-slate-950"><span>{text.profitAfterCommission}</span><strong>{formatCurrency(totals.profit_after_commission)} / {totals.profit_after_commission_percent.toFixed(1)} %</strong></div>
          </>}
        </div>
      </CardContent>
    </Card>
  );
};

export default CrmLineItemsTable;
