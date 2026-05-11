import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Plus, Edit2, Trash2, ShoppingCart, Search, FileText, Eye } from 'lucide-react';
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
import { Badge } from '@/components/ui/badge';
import PageHeader from '@/components/ui/page-header';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

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

const buildTemplatePreviewHtml = (template) => {
  const rawContent = String(template?.content || '<p>Šablona zatím nemá obsah.</p>');
  const filledContent = rawContent.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) => (
    key === 'items_table' ? sampleItemsTable : previewValues[key] || match
  ));

  return `<!doctype html>
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
    </html>`;
};

const OrderTemplateManager = ({ embedded = false }) => {
  const { toast } = useToast();
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(null);
  const [previewTemplate, setPreviewTemplate] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');

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
    if (!query) return templates;
    return templates.filter((template) => `${template.name || ''} ${template.description || ''}`.toLowerCase().includes(query));
  }, [searchTerm, templates]);

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
    </div>
  );
};

export default OrderTemplateManager;
