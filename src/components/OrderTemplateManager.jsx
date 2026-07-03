import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { sanitizeGeneratedDocumentHtml } from '@/lib/htmlSanitizer';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Plus, Edit2, Trash2, ShoppingCart, Search, FileText, Eye, Code2 } from 'lucide-react';
import OrderTemplateDialog from './OrderTemplateDialog';
import { Card, CardContent, CardHeader } from './ui/card';
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
} from '@/components/ui/alert-dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import PageHeader from '@/components/ui/page-header';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const templateCategoryOptions = [
  { value: 'all', label: 'Všechny typy' },
  { value: 'generic', label: 'Obecné' },
  { value: 'offer', label: 'Nabídky' },
  { value: 'order', label: 'Objednávky' },
  { value: 'contract', label: 'Smlouvy' },
  { value: 'handover_full', label: 'Celkové protokoly' },
  { value: 'handover_partial', label: 'Částečné protokoly' },
  { value: 'service_protocol', label: 'Servisní protokoly' },
];

const templateCategoryLabel = (value) => templateCategoryOptions.find((option) => option.value === value)?.label || value || 'Obecné';

const previewValues = {
  document_number: 'NAB-26-001',
  document_title: 'Ukázková nabídka FVE',
  document_type: 'Nabídka',
  document_date: '11.05.2026',
  document_valid_until: '25.05.2026',
  client_name: 'EKV Demo klient s.r.o.',
  project_name: 'FVE Rodinný dům',
  project_code: 'PRO-26-001',
  opportunity_title: 'FVE - ukázkový obchodní případ',
  opportunity_value: '171 900 Kč',
  subtotal: '142 066 Kč',
  discount_total: '0 Kč',
  tax_total: '29 834 Kč',
  total_amount: '171 900 Kč',
  total_with_tax: '171 900 Kč',
  notes: 'Ukázkový náhled šablony s doplněnými zástupnými symboly.',
  generated_at: '11.05.2026 13:00',
  supplier_name: 'EKV - Project s.r.o.',
  order_number: 'OBJ-26-001',
  order_date: '11.05.2026',
  delivery_date: '25.05.2026',
  realization_name: 'Realizace FVE Demo',
  admin_name: 'Jan Kopáčka',
  handover_scope: 'Předání projektové dokumentace, revizních podkladů a provozních informací.',
  service_description: 'Kontrola dokončené instalace a předání dokumentů zákazníkovi.',
  protocol_status: 'Rozpracováno',
  original_id: 'EKV-ORIG-2026-0001',
};

const sampleItemsTable = `
  <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:13px">
    <thead>
      <tr style="background:#f1f5f9">
        <th style="padding:8px;border:1px solid #cbd5e1;text-align:left">Kód</th>
        <th style="padding:8px;border:1px solid #cbd5e1;text-align:left">Název</th>
        <th style="padding:8px;border:1px solid #cbd5e1;text-align:right">Množství</th>
        <th style="padding:8px;border:1px solid #cbd5e1;text-align:right">Cena</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td style="padding:8px;border:1px solid #cbd5e1">SET-01</td>
        <td style="padding:8px;border:1px solid #cbd5e1">FVE sada 5 kWp</td>
        <td style="padding:8px;border:1px solid #cbd5e1;text-align:right">1 ks</td>
        <td style="padding:8px;border:1px solid #cbd5e1;text-align:right">139 000 Kč</td>
      </tr>
      <tr>
        <td style="padding:8px;border:1px solid #cbd5e1">INS-01</td>
        <td style="padding:8px;border:1px solid #cbd5e1">Instalace a uvedení do provozu</td>
        <td style="padding:8px;border:1px solid #cbd5e1;text-align:right">1 ks</td>
        <td style="padding:8px;border:1px solid #cbd5e1;text-align:right">32 900 Kč</td>
      </tr>
    </tbody>
  </table>
`;

const sampleDefectsTable = `
  <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:13px">
    <thead><tr style="background:#fff7ed"><th style="padding:8px;border:1px solid #fed7aa;text-align:left">Vada</th><th style="padding:8px;border:1px solid #fed7aa;text-align:left">Stav</th><th style="padding:8px;border:1px solid #fed7aa;text-align:left">Termín</th></tr></thead>
    <tbody><tr><td style="padding:8px;border:1px solid #fed7aa">Doplnit finální revizní zprávu</td><td style="padding:8px;border:1px solid #fed7aa">Otevřeno</td><td style="padding:8px;border:1px solid #fed7aa">do 7 dnů</td></tr></tbody>
  </table>
`;

const sampleSignaturesTable = `
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:28px">
    <div style="border-top:1px solid #0f172a;padding-top:8px">Za EKV Project</div>
    <div style="border-top:1px solid #0f172a;padding-top:8px">Za klienta</div>
  </div>
`;

const templateQuickKeys = [
  '{{document_number}}',
  '{{document_title}}',
  '{{client_name}}',
  '{{opportunity_title}}',
  '{{opportunity_description}}',
  '{{project_name}}',
  '{{document_date}}',
  '{{document_valid_until}}',
  '{{subtotal}}',
  '{{tax_total}}',
  '{{total_amount}}',
  '{{total_with_tax}}',
  '{{item_count}}',
  '{{items_table}}',
  '{{items_rows}}',
  '{{items_list}}',
  '{{handover_scope}}',
  '{{service_description}}',
  '{{defects_table}}',
  '{{signatures_table}}',
  '{{protocol_status}}',
  '{{original_id}}',
];

const itemTemplateKeys = [
  '{{item_position}}',
  '{{item_code}}',
  '{{item_name}}',
  '{{item_description}}',
  '{{item_quantity}}',
  '{{item_unit}}',
  '{{item_unit_price}}',
  '{{item_discount_percent}}',
  '{{item_vat_rate}}',
  '{{item_line_total}}',
];

const templateExamples = {
  fullTable: `<h2>Nabidka {{document_number}}</h2>
<p>Klient: <strong>{{client_name}}</strong></p>
<p>Obchodni pripad: {{opportunity_title}}</p>
<p>{{opportunity_description}}</p>

{{items_table}}

<p style="text-align:right"><strong>Celkem: {{total_with_tax}}</strong></p>`,
  customRows: `<table>
  <thead>
    <tr>
      <th>Kod</th>
      <th>Produkt</th>
      <th>Mnozstvi</th>
      <th>Cena celkem</th>
    </tr>
  </thead>
  <tbody>
    {{#items}}
    <tr>
      <td>{{item_code}}</td>
      <td>
        <strong>{{item_name}}</strong><br>
        {{item_description}}
      </td>
      <td>{{item_quantity}} {{item_unit}}</td>
      <td>{{item_line_total}}</td>
    </tr>
    {{/items}}
  </tbody>
</table>`,
  handoverFull: `<h1>Předávací protokol {{document_number}}</h1>
<p><strong>Klient:</strong> {{client_name}}</p>
<p><strong>Projekt:</strong> {{project_name}}</p>
<p><strong>Realizace:</strong> {{realization_name}}</p>

<h2>Rozsah předání</h2>
<p>{{handover_scope}}</p>

<h2>Předané položky</h2>
{{items_table}}

<h2>Vady a nedodělky</h2>
{{defects_table}}

<h2>Podpisy</h2>
{{signatures_table}}`,
  serviceProtocol: `<h1>Servisní protokol {{document_number}}</h1>
<p>Klient: {{client_name}}</p>
<p>Projekt: {{project_name}}</p>
<h2>Popis zásahu</h2>
<p>{{service_description}}</p>
{{items_table}}
{{signatures_table}}`,
};

const buildTemplatePreviewHtml = (template) => {
  const rawContent = String(template?.content || '<p>Šablona zatím nemá obsah.</p>');
  const replaceKey = (match, key) => {
    if (key === 'items_table') return sampleItemsTable;
    if (key === 'defects_table') return sampleDefectsTable;
    if (key === 'signatures_table') return sampleSignaturesTable;
    return previewValues[key] || match;
  };
  const filledContent = rawContent
    .replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, replaceKey)
    .replace(/\{([a-zA-Z0-9_]+)\}/g, replaceKey);

  return sanitizeGeneratedDocumentHtml(`<!doctype html>
    <html lang="cs">
      <head>
        <meta charset="utf-8" />
        <style>
          body { margin: 0; padding: 28px; color: #0f172a; font-family: Arial, sans-serif; background: #fff; }
          h1, h2, h3 { color: #0f172a; }
          p { line-height: 1.5; }
        </style>
      </head>
      <body>${filledContent}</body>
    </html>`);
};

const OrderTemplateManager = ({ embedded = false }) => {
  const { toast } = useToast();
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(null);
  const [previewTemplate, setPreviewTemplate] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from('order_templates').select('*').order('name');
    if (error) {
      toast({ title: 'Chyba při načítání šablon', variant: 'destructive', description: error.message });
    } else {
      setTemplates(data || []);
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  const handleSaveTemplate = async (templateData) => {
    const { id, ...dataToSave } = templateData;
    const query = id
      ? supabase.from('order_templates').update(dataToSave).eq('id', id)
      : supabase.from('order_templates').insert(dataToSave);

    const { error } = await query;
    if (error) {
      toast({ title: 'Chyba při ukládání šablony', variant: 'destructive', description: error.message });
      return;
    }

    toast({ title: 'Šablona uložena' });
    setIsDialogOpen(false);
    setEditingTemplate(null);
    fetchTemplates();
  };

  const handleDeleteTemplate = async (templateId) => {
    const { error } = await supabase.from('order_templates').delete().eq('id', templateId);
    if (error) {
      toast({ title: 'Chyba při mazání šablony', variant: 'destructive', description: error.message });
      return;
    }

    toast({ title: 'Šablona smazána' });
    fetchTemplates();
  };

  const filteredTemplates = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return templates.filter((template) => {
      const matchesCategory = categoryFilter === 'all' || (template.document_category || 'generic') === categoryFilter;
      const matchesQuery = !query || `${template.name || ''} ${template.description || ''} ${template.document_category || ''}`.toLowerCase().includes(query);
      return matchesCategory && matchesQuery;
    });
  }, [categoryFilter, searchTerm, templates]);

  const openNewTemplate = () => {
    setEditingTemplate(null);
    setIsDialogOpen(true);
  };

  return (
    <div className="space-y-6">
      {!embedded && (
        <PageHeader
          icon={ShoppingCart}
          title="Šablony dokumentů"
          description="Vytvářejte a upravujte HTML, TXT a DOCX šablony pro nabídky, objednávky a smlouvy."
          actions={(
            <Button onClick={openNewTemplate} className="w-full sm:w-auto">
              <Plus className="mr-2 h-4 w-4" /> Nová šablona
            </Button>
          )}
        />
      )}

      <Card className="overflow-hidden">
        <CardHeader className="gap-4 border-b bg-slate-50/60">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold">Knihovna šablon</h2>
                <Badge variant="secondary">{templates.length} šablon</Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                Šablony používají zástupné symboly pro klienta, položky, částky a údaje obchodního případu.
              </p>
            </div>
            <div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto">
              <div className="relative w-full lg:w-80">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Hledat šablonu..."
                  className="pl-8"
                />
              </div>
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="w-full bg-white sm:w-56"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {templateCategoryOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button onClick={openNewTemplate} className="w-full sm:w-auto">
                <Plus className="mr-2 h-4 w-4" /> Nová šablona
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-10 text-center text-muted-foreground">Načítání šablon...</div>
          ) : filteredTemplates.length === 0 ? (
            <div className="p-12 text-center">
              <FileText className="mx-auto mb-3 h-12 w-12 text-slate-300" />
              <h3 className="text-lg font-medium">Žádné šablony</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {templates.length === 0 ? 'Zatím nejsou vytvořené žádné šablony dokumentů.' : 'Zkuste upravit hledání.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[220px]">Název</TableHead>
                    <TableHead className="min-w-[260px]">Popis</TableHead>
                    <TableHead className="min-w-[170px]">Typ</TableHead>
                    <TableHead className="w-[110px]">Stav</TableHead>
                    <TableHead className="w-[120px] text-right">Akce</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTemplates.map((template) => (
                    <TableRow key={template.id}>
                      <TableCell className="font-medium">{template.name}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {template.description || <span className="italic text-slate-400">Bez popisu</span>}
                      </TableCell>
                      <TableCell><Badge variant="outline">{templateCategoryLabel(template.document_category || 'generic')}</Badge></TableCell>
                      <TableCell><Badge variant={template.is_active === false ? 'secondary' : 'default'}>{template.is_active === false ? 'Neaktivní' : 'Aktivní'}</Badge></TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon" onClick={() => setPreviewTemplate(template)} title="Náhled">
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => { setEditingTemplate(template); setIsDialogOpen(true); }}>
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <Trash2 className="h-4 w-4 text-red-500" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Opravdu smazat šablonu?</AlertDialogTitle>
                              <AlertDialogDescription>Tato akce je nevratná.</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Zrušit</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleDeleteTemplate(template.id)}>Smazat</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>

        <OrderTemplateDialog
          isOpen={isDialogOpen}
          onClose={() => setIsDialogOpen(false)}
          onSave={handleSaveTemplate}
          template={editingTemplate}
        />

        <Dialog open={!!previewTemplate} onOpenChange={(open) => !open && setPreviewTemplate(null)}>
          <DialogContent className="max-w-5xl">
            <DialogHeader>
              <DialogTitle>Náhled šablony: {previewTemplate?.name}</DialogTitle>
            </DialogHeader>
            <div className="overflow-hidden rounded-lg border bg-white">
              <iframe
                title={`Náhled šablony ${previewTemplate?.name || ''}`}
                sandbox=""
                srcDoc={buildTemplatePreviewHtml(previewTemplate)}
                className="h-[70vh] w-full bg-white"
              />
            </div>
          </DialogContent>
        </Dialog>
      </Card>

      <Card>
        <CardHeader className="border-b bg-slate-50/60">
          <div className="flex items-center gap-2">
            <Code2 className="h-4 w-4 text-slate-500" />
            <div>
              <h2 className="text-lg font-semibold">Reference šablon</h2>
              <p className="text-sm text-muted-foreground">Placeholdery a HTML ukázky pro úpravu dokumentových šablon.</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 p-4">
          <details className="rounded-xl border bg-white p-4 shadow-sm">
            <summary className="cursor-pointer text-sm font-semibold text-slate-900">Zobrazit placeholdery a ukázky</summary>
            <div className="mt-4 space-y-4">
              <div className="grid gap-4 xl:grid-cols-2">
                <div className="rounded-xl border bg-white p-4 shadow-sm">
                  <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <Code2 className="h-4 w-4 text-blue-600" />
                    Značky dokumentu
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {templateQuickKeys.map((key) => (
                      <code key={key} className="rounded-full border bg-slate-50 px-2.5 py-1 text-xs text-slate-700">{key}</code>
                    ))}
                  </div>
                </div>
                <div className="rounded-xl border bg-white p-4 shadow-sm">
                  <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <Code2 className="h-4 w-4 text-emerald-600" />
                    Značky položek
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {itemTemplateKeys.map((key) => (
                      <code key={key} className="rounded-full border bg-slate-50 px-2.5 py-1 text-xs text-slate-700">{key}</code>
                    ))}
                  </div>
                </div>
              </div>
              <div className="grid gap-4 xl:grid-cols-2">
                <div className="rounded-xl border bg-slate-950 p-4 text-slate-100 shadow-sm">
                  <div className="mb-3 text-sm font-semibold">Automatická tabulka položek</div>
                  <pre className="max-h-80 overflow-auto whitespace-pre-wrap text-xs leading-relaxed text-slate-200"><code>{templateExamples.fullTable}</code></pre>
                </div>
                <div className="rounded-xl border bg-slate-950 p-4 text-slate-100 shadow-sm">
                  <div className="mb-3 text-sm font-semibold">Vlastní produktové řádky</div>
                  <pre className="max-h-80 overflow-auto whitespace-pre-wrap text-xs leading-relaxed text-slate-200"><code>{templateExamples.customRows}</code></pre>
                </div>
                <div className="rounded-xl border bg-slate-950 p-4 text-slate-100 shadow-sm">
                  <div className="mb-3 text-sm font-semibold">Celkový předávací protokol</div>
                  <pre className="max-h-80 overflow-auto whitespace-pre-wrap text-xs leading-relaxed text-slate-200"><code>{templateExamples.handoverFull}</code></pre>
                </div>
                <div className="rounded-xl border bg-slate-950 p-4 text-slate-100 shadow-sm">
                  <div className="mb-3 text-sm font-semibold">Servisní protokol</div>
                  <pre className="max-h-80 overflow-auto whitespace-pre-wrap text-xs leading-relaxed text-slate-200"><code>{templateExamples.serviceProtocol}</code></pre>
                </div>
              </div>
            </div>
          </details>
        </CardContent>
      </Card>
    </div>
  );
};

export default OrderTemplateManager;
