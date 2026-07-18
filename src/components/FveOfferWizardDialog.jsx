import React, { useEffect, useMemo, useState } from 'react';
import { Calculator, Check, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { calculateCrmTotals } from '@/lib/crmItemPayloads';
import { buildFveOfferItems, chooseFveRuleSet, loadFveOfferRuleSets } from '@/lib/fveOfferRulesService';
import { VAT_RATE_OPTIONS } from '@/lib/financePresentation';

const formatCurrency = (value) => new Intl.NumberFormat('cs-CZ', {
  style: 'currency',
  currency: 'CZK',
  maximumFractionDigits: 0,
}).format(Number(value || 0));

const FveOfferWizardDialog = ({ open, onOpenChange, onApply }) => {
  const [loading, setLoading] = useState(false);
  const [ruleSets, setRuleSets] = useState([]);
  const [inputs, setInputs] = useState({
    power_kwp: 6,
    battery_kwh: 10,
    include_wallbox: false,
    roof_type: 'standard',
    customer_type: 'household',
    vat_rate: 21,
  });

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    loadFveOfferRuleSets()
      .then(setRuleSets)
      .finally(() => setLoading(false));
  }, [open]);

  const selectedRuleSet = useMemo(() => chooseFveRuleSet(ruleSets, inputs), [ruleSets, inputs]);
  const items = useMemo(() => buildFveOfferItems(selectedRuleSet, inputs), [selectedRuleSet, inputs]);
  const totals = useMemo(() => calculateCrmTotals(items), [items]);

  const update = (key, value) => setInputs((prev) => ({ ...prev, [key]: value }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5 text-primary" />
            Jednoduchá FVE nabídka
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
          <div className="space-y-4 rounded-xl border bg-slate-50/70 p-4">
            <div className="space-y-1.5">
              <Label>Výkon FVE (kWp)</Label>
              <Input
                type="number"
                min="0"
                step="0.1"
                value={inputs.power_kwp}
                onChange={(event) => update('power_kwp', Number(event.target.value || 0))}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Kapacita baterie (kWh)</Label>
              <Input
                type="number"
                min="0"
                step="0.1"
                value={inputs.battery_kwh}
                onChange={(event) => update('battery_kwh', Number(event.target.value || 0))}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Typ střechy / instalace</Label>
              <Select value={inputs.roof_type} onValueChange={(value) => update('roof_type', value)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="standard">Standard</SelectItem>
                  <SelectItem value="flat">Plochá střecha</SelectItem>
                  <SelectItem value="tile">Tašková střecha</SelectItem>
                  <SelectItem value="metal">Plechová střecha</SelectItem>
                  <SelectItem value="trapezoid">Trapézový plech</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Typ zákazníka</Label>
              <Select value={inputs.customer_type} onValueChange={(value) => update('customer_type', value)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="household">Domácnost</SelectItem>
                  <SelectItem value="company">Firma</SelectItem>
                  <SelectItem value="municipality">Obec / veřejný sektor</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between rounded-lg border bg-white px-3 py-2">
              <Label htmlFor="fve-wallbox">Wallbox</Label>
              <Switch
                id="fve-wallbox"
                checked={inputs.include_wallbox}
                onCheckedChange={(value) => update('include_wallbox', value)}
              />
            </div>

            <div className="rounded-lg border bg-white p-3 text-sm">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Pravidlová sada</div>
              <div className="mt-1 font-semibold text-slate-950">{selectedRuleSet?.name || 'Výchozí sada'}</div>
              <p className="mt-1 text-xs text-slate-500">
                Položky lze po vložení normálně ručně upravit.
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-950">Náhled položek</h3>
                <p className="text-xs text-slate-500">Vloží se jako běžné CRM položky nabídky/OP.</p>
              </div>
              <Badge variant="outline">{items.length} položek · {formatCurrency(totals.total + totals.tax_total)}</Badge>
            </div>

            <div className="max-h-[430px] overflow-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Kód</TableHead>
                    <TableHead>Název</TableHead>
                    <TableHead className="text-right">Množství</TableHead>
                    <TableHead className="text-right">Cena</TableHead>
                    <TableHead className="text-right">Celkem</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-8 text-center">
                        <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                      </TableCell>
                    </TableRow>
                  ) : items.map((item) => (
                    <TableRow key={item.id || item.code}>
                      <TableCell className="font-mono text-xs">{item.code || '-'}</TableCell>
                      <TableCell>
                        <div className="font-medium">{item.name}</div>
                        {item.description && <div className="text-xs text-slate-500">{item.description}</div>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {Number(item.quantity || 0).toLocaleString('cs-CZ')} {item.unit}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatCurrency(item.unit_price)}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{formatCurrency(item.line_total)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="rounded-lg border bg-white p-3">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-950">Finance</div>
                  <p className="text-xs text-slate-500">DPH patří do finančního výpočtu nabídky, ne do parametrů návrhu.</p>
                </div>
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-slate-500">Sazba DPH</Label>
                  <Select value={String(inputs.vat_rate)} onValueChange={(value) => update('vat_rate', Number(value))}>
                    <SelectTrigger className="h-9 w-28"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {VAT_RATE_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-2 text-sm sm:grid-cols-3">
                <div className="rounded-lg border bg-slate-50 p-3">
                  <span className="text-slate-500">Bez DPH</span>
                  <div className="font-semibold">{formatCurrency(totals.total)}</div>
                </div>
                <div className="rounded-lg border bg-slate-50 p-3">
                  <span className="text-slate-500">DPH</span>
                  <div className="font-semibold">{formatCurrency(totals.tax_total)}</div>
                </div>
                <div className="rounded-lg border bg-primary p-3 text-primary-foreground">
                  <span>Celkem</span>
                  <div className="font-semibold">{formatCurrency(totals.total + totals.tax_total)}</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Zrušit</Button>
          <Button onClick={() => onApply(items)} disabled={loading || items.length === 0}>
            <Check className="mr-2 h-4 w-4" />
            Vložit položky
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default FveOfferWizardDialog;
