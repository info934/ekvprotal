import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, FileText, Package, Plus, RefreshCw, Save, Search, ShoppingCart, Trash2 } from 'lucide-react';
import PageHeader from '@/components/ui/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import SubjectSelect from '@/components/SubjectSelect';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
import { DEFAULT_CRM_NUMBERING, formatCrmNumber, normalizeCrmNumbering } from '@/lib/crmNumbering';
import {
  downloadGeneratedDocumentDocx,
  downloadGeneratedDocumentHtml,
  downloadGeneratedDocumentPdf,
} from '@/lib/documentGenerationService';
import { cn } from '@/lib/utils';

const documentTypeConfig = {
  offer: {
    title: 'Nabidky',
    detailTitle: 'Detail nabidky',
    singular: 'Nabidka',
    icon: Package,
    listPath: '/crm/offers',
    detailPath: (id) => `/crm/offers/${id}`,
    createLabel: 'Nova nabidka',
  },
  order: {
    title: 'Objednavky',
    detailTitle: 'Detail objednavky',
    singular: 'Objednavka',
    icon: ShoppingCart,
    listPath: '/crm/orders',
    detailPath: (id) => `/crm/orders/${id}`,
    createLabel: 'Nova objednavka',
  },
};

const documentStatuses = [
  { value: 'draft', label: 'Priprava' },
  { value: 'sent', label: 'Odeslano' },
  { value: 'accepted', label: 'Prijato' },
  { value: 'rejected', label: 'Zamitnuto' },
  { value: 'closed', label: 'Uzavreno' },
];

const formatCurrency = (value) => new Intl.NumberFormat('cs-CZ', {
  style: 'currency',
  currency: 'CZK',
  maximumFractionDigits: 0,
}).format(Number(value || 0));

const formatDate = (value) => {
  if (!value) return '-';
  return new Intl.DateTimeFormat('cs-CZ', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(value));
};

const emptyItem = () => ({
  id: `new-${Date.now()}`,
  catalog_item_id: null,
  code: '',
  name: '',
  description: '',
  quantity: 1,
  unit: 'ks',
  unit_price: 0,
  discount_percent: 0,
  vat_rate: 21,
  line_total: 0,
  sort_order: 0,
  isNew: true,
});

const calculateLineTotal = (item) => {
  const quantity = Number(item.quantity || 0);
  const price = Number(item.unit_price || 0);
  const discount = Math.min(100, Math.max(0, Number(item.discount_percent || 0)));
  return Math.round(quantity * price * (1 - (discount / 100)) * 100) / 100;
};

const calculateTotals = (items) => {
  const subtotal = items.reduce((sum, item) => sum + calculateLineTotal(item), 0);
  const taxTotal = items.reduce((sum, item) => sum + (calculateLineTotal(item) * (Number(item.vat_rate || 0) / 100)), 0);
  return {
    subtotal,
    discount_total: 0,
    tax_total: Math.round(taxTotal * 100) / 100,
    total: subtotal,
  };
};

const buildItemPayload = (item, documentId, index) => ({
  document_id: documentId,
  catalog_item_id: item.catalog_item_id || null,
  code: item.code || null,
  name: item.name?.trim() || 'Polozka',
  description: item.description || null,
  quantity: Number(item.quantity || 0),
  unit: item.unit || 'ks',
  unit_price: Number(item.unit_price || 0),
  discount_percent: Number(item.discount_percent || 0),
  vat_rate: Number(item.vat_rate || 0),
  line_total: calculateLineTotal(item),
  sort_order: (index + 1) * 10,
});

const buildOpportunityItemPayload = (item, opportunityId, index) => {
  const payload = buildItemPayload(item, null, index);
  delete payload.document_id;
  return {
    ...payload,
    opportunity_id: opportunityId,
  };
};

const CRMCommercialDocuments = ({ type = 'offer' }) => {
  const config = documentTypeConfig[type] || documentTypeConfig.offer;
  const Icon = config.icon;
  const { documentId } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { hasPermission } = useAuth();
  const canEdit = hasPermission('crm', 'can_edit');
  const [documents, setDocuments] = useState([]);
  const [selectedDocument, setSelectedDocument] = useState(null);
  const [opportunities, setOpportunities] = useState([]);
  const [documentTemplates, setDocumentTemplates] = useState([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('default');
  const [numbering, setNumbering] = useState(() => normalizeCrmNumbering(Object.values(DEFAULT_CRM_NUMBERING)));
  const [query, setQuery] = useState('');
  const [catalogProducts, setCatalogProducts] = useState([]);
  const [catalogQuery, setCatalogQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [documentsRes, opportunitiesRes, numberingRes, templatesRes] = await Promise.all([
      supabase
        .from('crm_commercial_documents')
        .select('id, opportunity_id, subject_id, type, status, number, title, issue_date, valid_until, subtotal, discount_total, tax_total, total, notes, sync_items, created_at, subject:subject_id(id, name, ico), opportunity:opportunity_id(id, number, title, value, stage, subject:subject_id(id, name), project:project_id(id, name, code), opportunity_items:crm_opportunity_items(id, catalog_item_id, code, name, description, quantity, unit, unit_price, discount_percent, vat_rate, line_total, sort_order)), items:crm_commercial_document_items(id, catalog_item_id, code, name, description, quantity, unit, unit_price, discount_percent, vat_rate, line_total, sort_order)')
        .eq('type', type)
        .order('created_at', { ascending: false }),
      supabase
        .from('crm_opportunities')
        .select('id, number, title, value, subject_id, subject:subject_id(id, name), items:crm_opportunity_items(id, catalog_item_id, code, name, description, quantity, unit, unit_price, discount_percent, vat_rate, line_total, sort_order)')
        .order('created_at', { ascending: false }),
      supabase
        .from('crm_numbering_settings')
        .select('document_type, prefix, next_number, padding'),
      supabase
        .from('order_templates')
        .select('id, name, content')
        .eq('is_active', true)
        .order('name'),
    ]);

    const error = documentsRes.error || opportunitiesRes.error;
    if (error) {
      toast({ title: `${config.title} se nepodarilo nacist`, description: error.message, variant: 'destructive' });
      setLoading(false);
      return;
    }

    const normalizedDocuments = (documentsRes.data || []).map((document) => ({
      ...document,
      sync_items: document.sync_items ?? true,
      items: [...((document.sync_items ?? true) ? (document.opportunity?.opportunity_items || []) : (document.items || []))]
        .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0)),
    }));
    setDocuments(normalizedDocuments);
    setOpportunities(opportunitiesRes.data || []);
    setDocumentTemplates(templatesRes.error ? [] : (templatesRes.data || []));
    setNumbering(normalizeCrmNumbering(numberingRes.error ? [] : numberingRes.data));
    setSelectedDocument(documentId ? normalizedDocuments.find((document) => document.id === documentId) || null : null);

    const { data: catalogData, error: catalogError } = await supabase
      .from('commercial_item_catalog')
      .select('id, code, name, description, category, unit, default_unit_price, default_vat_rate, is_active')
      .eq('is_active', true)
      .order('name', { ascending: true });
    setCatalogProducts(catalogError ? [] : (catalogData || []));

    setLoading(false);
  }, [config.title, documentId, toast, type]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filteredDocuments = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return documents;
    return documents.filter((document) => [
      document.number,
      document.title,
      document.subject?.name,
      document.opportunity?.number,
      document.opportunity?.title,
      document.opportunity?.subject?.name,
    ].filter(Boolean).some((value) => String(value).toLowerCase().includes(needle)));
  }, [documents, query]);

  const updateSelectedDocument = (field, value) => {
    setSelectedDocument((current) => current ? { ...current, [field]: value } : current);
  };

  const updateSelectedDocumentSubject = (subjectId, subject = null) => {
    setSelectedDocument((current) => current ? {
      ...current,
      subject_id: subjectId,
      subject: subjectId ? (subject || current.subject) : null,
    } : current);
  };

  const updateItem = (itemId, field, value) => {
    setSelectedDocument((current) => {
      if (!current) return current;
      return {
        ...current,
        items: current.items.map((item) => {
          if (item.id !== itemId) return item;
          const next = { ...item, [field]: ['quantity', 'unit_price', 'discount_percent', 'vat_rate'].includes(field) ? Number(value || 0) : value };
          return { ...next, line_total: calculateLineTotal(next) };
        }),
      };
    });
  };

  const addItem = () => {
    setSelectedDocument((current) => current ? { ...current, items: [...current.items, emptyItem()] } : current);
  };

  const filteredCatalogProducts = useMemo(() => {
    const needle = catalogQuery.trim().toLowerCase();
    return catalogProducts
      .filter((product) => {
        if (!needle) return true;
        return [product.code, product.name, product.description, product.category]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(needle));
      })
      .slice(0, 14);
  }, [catalogProducts, catalogQuery]);

  const addCatalogItem = (product) => {
    const nextItem = {
      ...emptyItem(),
      id: `new-${Date.now()}-${product.id}`,
      catalog_item_id: product.id,
      code: product.code || '',
      name: product.name || 'Polozka',
      description: product.description || '',
      unit: product.unit || 'ks',
      unit_price: Number(product.default_unit_price || 0),
      vat_rate: Number(product.default_vat_rate || 21),
    };
    setSelectedDocument((current) => current ? {
      ...current,
      items: [...current.items, { ...nextItem, line_total: calculateLineTotal(nextItem) }],
    } : current);
    setCatalogQuery('');
  };

  const removeItem = (itemId) => {
    setSelectedDocument((current) => current ? { ...current, items: current.items.filter((item) => item.id !== itemId) } : current);
  };

  const syncItemsToOpportunityDocuments = async (sourceDocument, itemPayloads) => {
    if (!sourceDocument.sync_items) return null;

    const targets = documents.filter((document) => (
      document.opportunity_id === sourceDocument.opportunity_id &&
      (document.sync_items ?? true)
    ));

    for (const target of targets) {
      const clonedItems = itemPayloads.map(({ document_id, ...item }, index) => ({
        ...item,
        document_id: target.id,
        sort_order: (index + 1) * 10,
      }));
      const totals = calculateTotals(clonedItems);
      const { error: deleteError } = await supabase
        .from('crm_commercial_document_items')
        .delete()
        .eq('document_id', target.id);
      if (deleteError) return deleteError;

      if (clonedItems.length > 0) {
        const { error: insertError } = await supabase
          .from('crm_commercial_document_items')
          .insert(clonedItems);
        if (insertError) return insertError;
      }

      const { error: updateError } = await supabase
        .from('crm_commercial_documents')
        .update({ ...totals, updated_at: new Date().toISOString() })
        .eq('id', target.id);
      if (updateError) return updateError;
    }

    return null;
  };

  const handleSaveDocument = async () => {
    if (!selectedDocument || !canEdit) return;
    setSaving(true);

    const items = selectedDocument.items.map((item, index) => buildItemPayload(item, selectedDocument.id, index));
    const totals = calculateTotals(items);
    const { error: docError } = await supabase
      .from('crm_commercial_documents')
      .update({
        title: selectedDocument.title?.trim() || config.singular,
        status: selectedDocument.status || 'draft',
        issue_date: selectedDocument.issue_date || new Date().toISOString().slice(0, 10),
        valid_until: selectedDocument.valid_until || null,
        notes: selectedDocument.notes || null,
        subject_id: selectedDocument.subject_id || null,
        sync_items: selectedDocument.sync_items ?? true,
        ...totals,
        updated_at: new Date().toISOString(),
      })
      .eq('id', selectedDocument.id);

    if (docError) {
      setSaving(false);
      toast({ title: 'Dokument se nepodarilo ulozit', description: docError.message, variant: 'destructive' });
      return;
    }

    const sourceIsOpportunity = selectedDocument.sync_items ?? true;
    const itemTable = sourceIsOpportunity ? 'crm_opportunity_items' : 'crm_commercial_document_items';
    const itemFilterColumn = sourceIsOpportunity ? 'opportunity_id' : 'document_id';
    const itemFilterValue = sourceIsOpportunity ? selectedDocument.opportunity_id : selectedDocument.id;
    const itemRows = sourceIsOpportunity
      ? selectedDocument.items.map((item, index) => buildOpportunityItemPayload(item, selectedDocument.opportunity_id, index))
      : items;

    const { error: deleteError } = await supabase
      .from(itemTable)
      .delete()
      .eq(itemFilterColumn, itemFilterValue);

    if (deleteError) {
      setSaving(false);
      toast({ title: 'Polozky se nepodarilo ulozit', description: deleteError.message, variant: 'destructive' });
      return;
    }

    if (itemRows.length > 0) {
      const { error: insertError } = await supabase
        .from(itemTable)
        .insert(itemRows);
      if (insertError) {
        setSaving(false);
        toast({ title: 'Polozky se nepodarilo ulozit', description: insertError.message, variant: 'destructive' });
        return;
      }
    }

    const syncError = sourceIsOpportunity
      ? await syncItemsToOpportunityDocuments({ ...selectedDocument, ...totals }, items)
      : null;
    setSaving(false);
    if (syncError) {
      toast({ title: 'Dokument ulozen, synchronizace polozek selhala', description: syncError.message, variant: 'destructive' });
    } else {
      toast({ title: selectedDocument.sync_items ? 'Dokument ulozen a polozky synchronizovany' : 'Dokument ulozen' });
    }
    fetchData();
  };

  const handleCreateDocument = async () => {
    if (!canEdit || opportunities.length === 0) return;
    const opportunity = opportunities[0];
    const number = formatCrmNumber(numbering, type);
    const sourceItems = [...(opportunity.items || [])].sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
    const totals = calculateTotals(sourceItems.length > 0 ? sourceItems : [{
      quantity: 1,
      unit_price: Number(opportunity.value || 0),
      discount_percent: 0,
      vat_rate: 21,
    }]);
    setSaving(true);
    const { data, error } = await supabase
      .from('crm_commercial_documents')
      .insert({
        opportunity_id: opportunity.id,
        subject_id: opportunity.subject_id,
        type,
        status: 'draft',
        number,
        title: `${config.singular} - ${opportunity.title}`,
        issue_date: new Date().toISOString().slice(0, 10),
        valid_until: null,
        sync_items: true,
        ...totals,
      })
      .select('id')
      .single();

    if (!error) {
      const documentRows = (sourceItems.length > 0 ? sourceItems : [{
        code: 'CRM-001',
        name: opportunity.title,
        quantity: 1,
        unit: 'ks',
        unit_price: Number(opportunity.value || 0),
        discount_percent: 0,
        vat_rate: 21,
      }]).map((item, index) => buildItemPayload(item, data.id, index));
      if (documentRows.length > 0) {
        await supabase.from('crm_commercial_document_items').insert(documentRows);
      }
      const nextNumber = Number(numbering[type]?.next_number || 1) + 1;
      await supabase
        .from('crm_numbering_settings')
        .update({ next_number: nextNumber, updated_at: new Date().toISOString() })
        .eq('document_type', type);
    }

    setSaving(false);
    if (error) {
      toast({ title: `${config.singular} se nepodarilo vytvorit`, description: error.message, variant: 'destructive' });
      return;
    }

    toast({ title: `${config.singular} vytvorena` });
    navigate(config.detailPath(data.id));
  };

  const handleGenerateSelectedDocument = async (format = 'docx') => {
    if (!selectedDocument) return;
    setSaving(true);
    try {
      const template = documentTemplates.find((item) => item.id === selectedTemplateId) || null;
      const generationInput = {
        document: selectedDocument,
        opportunity: {
          ...selectedDocument.opportunity,
          subject: selectedDocument.subject || selectedDocument.opportunity?.subject,
        },
        template,
      };

      if (format === 'pdf') {
        downloadGeneratedDocumentPdf(generationInput);
      } else if (format === 'html') {
        downloadGeneratedDocumentHtml(generationInput);
      } else {
        await downloadGeneratedDocumentDocx(generationInput);
      }

      toast({
        title: 'Dokument vygenerovan',
        description: `${template?.name ? `Sablona "${template.name}" byla vyplnena. ` : ''}Vystup ${format.toUpperCase()} byl pripraven ke stazeni.`,
      });
    } catch (error) {
      toast({
        title: 'Dokument se nepodarilo vygenerovat',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  if (documentId) {
    const totalWithTax = Number(selectedDocument?.total || 0) + Number(selectedDocument?.tax_total || 0);
    return (
      <div className="app-page-wide space-y-6">
        <PageHeader
          icon={Icon}
          title={selectedDocument?.title || config.detailTitle}
          description={selectedDocument?.number || 'Nacitani detailu dokumentu'}
          actions={(
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={() => navigate(config.listPath)}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                Zpet na seznam
              </Button>
              <div className="flex items-center gap-2 rounded-md border bg-white p-1">
                <Select value={selectedTemplateId} onValueChange={setSelectedTemplateId}>
                  <SelectTrigger className="h-9 w-[210px] border-0 bg-transparent shadow-none focus:ring-0">
                    <SelectValue placeholder="Sablona dokumentu" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">Vychozi sablona</SelectItem>
                    {documentTemplates.map((template) => (
                      <SelectItem key={template.id} value={template.id}>{template.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" className="h-9" disabled={saving || !selectedDocument}>
                      <FileText className="mr-2 h-4 w-4" />
                      Generovat
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-52">
                    <DropdownMenuLabel>Vystup dokumentu</DropdownMenuLabel>
                    <DropdownMenuItem onSelect={() => handleGenerateSelectedDocument('docx')}>DOCX</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => handleGenerateSelectedDocument('pdf')}>PDF</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => handleGenerateSelectedDocument('html')}>HTML</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem disabled>Vybrana sablona se pouzije automaticky</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <Button onClick={handleSaveDocument} disabled={!canEdit || saving || !selectedDocument}>
                <Save className="mr-2 h-4 w-4" />
                {saving ? 'Ukladam...' : 'Ulozit'}
              </Button>
            </div>
          )}
        />

        {loading || !selectedDocument ? (
          <Card><CardContent className="p-8 text-sm text-muted-foreground">Nacitam dokument...</CardContent></Card>
        ) : (
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(300px,0.55fr)]">
            <Card className="crm-panel">
              <CardHeader className="crm-panel-header">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {config.singular} {selectedDocument.number || ''}
                    </div>
                    <CardTitle className="mt-1 text-3xl font-semibold tracking-tight">{selectedDocument.title}</CardTitle>
                    <CardDescription className="mt-2">
                      <Link to={`/crm/${selectedDocument.opportunity_id}`} className="font-medium text-primary hover:underline">
                        {selectedDocument.opportunity?.number || 'OP'} - {selectedDocument.opportunity?.title}
                      </Link>
                    </CardDescription>
                  </div>
                  <Badge variant="outline" className="w-fit">{documentStatuses.find((status) => status.value === selectedDocument.status)?.label || selectedDocument.status}</Badge>
                </div>
              </CardHeader>
              <CardContent className="grid gap-4 bg-white p-5 md:grid-cols-2">
                <div className="space-y-2 md:col-span-2">
                  <Label>Nazev dokumentu</Label>
                  <Input value={selectedDocument.title || ''} onChange={(event) => updateSelectedDocument('title', event.target.value)} disabled={!canEdit || saving} />
                </div>
                <div className="space-y-2">
                  <Label>Stav</Label>
                  <Select value={selectedDocument.status || 'draft'} onValueChange={(value) => updateSelectedDocument('status', value)} disabled={!canEdit || saving}>
                    <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {documentStatuses.map((status) => <SelectItem key={status.value} value={status.value}>{status.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <SubjectSelect
                    label="Subjekt dokumentu"
                    value={selectedDocument.subject_id || ''}
                    onChange={(value, subject) => updateSelectedDocumentSubject(value || null, subject)}
                    onCreated={(subject) => updateSelectedDocumentSubject(subject.id, subject)}
                    placeholder="Vyberte nebo vytvorte subjekt"
                    disabled={!canEdit || saving}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Vystaveno</Label>
                  <Input type="date" value={selectedDocument.issue_date || ''} onChange={(event) => updateSelectedDocument('issue_date', event.target.value)} disabled={!canEdit || saving} />
                </div>
                <div className="space-y-2">
                  <Label>Platnost do</Label>
                  <Input type="date" value={selectedDocument.valid_until || ''} onChange={(event) => updateSelectedDocument('valid_until', event.target.value)} disabled={!canEdit || saving} />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>Popis / poznamka</Label>
                  <Textarea value={selectedDocument.notes || ''} onChange={(event) => updateSelectedDocument('notes', event.target.value)} rows={5} disabled={!canEdit || saving} />
                </div>
              </CardContent>
            </Card>

            <div className="space-y-4">
              <Card className="crm-panel">
                <CardHeader className="crm-panel-header">
                  <CardTitle className="text-base">Souhrn</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 p-4 text-sm">
                  <div className="flex justify-between gap-3"><span className="text-muted-foreground">Bez DPH</span><strong>{formatCurrency(selectedDocument.total)}</strong></div>
                  <div className="flex justify-between gap-3"><span className="text-muted-foreground">DPH</span><strong>{formatCurrency(selectedDocument.tax_total)}</strong></div>
                  <div className="flex justify-between gap-3 rounded-md bg-primary px-3 py-2 text-primary-foreground"><span>Celkem</span><strong>{formatCurrency(totalWithTax)}</strong></div>
                </CardContent>
              </Card>
              <Card className="crm-panel">
                <CardHeader className="crm-panel-header">
                  <CardTitle className="text-base">Synchronizace polozek</CardTitle>
                  <CardDescription>Zapnuto znamena, ze polozky se pri ulozeni propisou do ostatnich synchronizovanych nabidek a objednavek stejneho obchodniho pripadu.</CardDescription>
                </CardHeader>
                <CardContent className="flex items-center justify-between gap-4 p-4">
                  <Label htmlFor="sync-items">Synchronizovat s obchodnim pripadem</Label>
                  <Switch id="sync-items" checked={selectedDocument.sync_items ?? true} onCheckedChange={(checked) => updateSelectedDocument('sync_items', checked)} disabled={!canEdit || saving} />
                </CardContent>
              </Card>
            </div>

            <Card className="crm-panel xl:col-span-2">
              <CardHeader className="crm-panel-header">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <CardTitle>Polozkovy seznam</CardTitle>
                    <CardDescription>Polozky jsou spolecne pro obchodni pripad, pokud u dokumentu nevypnete synchronizaci.</CardDescription>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button type="button" variant="outline" disabled={!canEdit || saving}>
                          <Plus className="mr-2 h-4 w-4" />
                          Pridat z katalogu
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-80">
                        <DropdownMenuLabel>Produktovy katalog</DropdownMenuLabel>
                        <div className="px-2 py-1.5">
                          <Input
                            value={catalogQuery}
                            onChange={(event) => setCatalogQuery(event.target.value)}
                            placeholder="Hledat produkt..."
                            className="h-8"
                          />
                        </div>
                        <DropdownMenuSeparator />
                        {filteredCatalogProducts.length === 0 ? (
                          <DropdownMenuItem disabled>Zadny produkt nenalezen</DropdownMenuItem>
                        ) : filteredCatalogProducts.map((product) => (
                          <DropdownMenuItem key={product.id} onSelect={() => addCatalogItem(product)} className="flex flex-col items-start gap-0.5">
                            <span className="font-medium">{product.name}</span>
                            <span className="text-xs text-muted-foreground">
                              {product.code || '-'} - {formatCurrency(product.default_unit_price)}
                            </span>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <Button type="button" variant="secondary" onClick={addItem} disabled={!canEdit || saving}>
                      Rucni polozka
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="crm-table-wrap">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="min-w-[110px]">Kod</TableHead>
                        <TableHead className="min-w-[260px]">Nazev</TableHead>
                        <TableHead className="min-w-[100px] text-right">Mnozstvi</TableHead>
                        <TableHead className="min-w-[90px]">MJ</TableHead>
                        <TableHead className="min-w-[130px] text-right">Cena</TableHead>
                        <TableHead className="min-w-[100px] text-right">Sleva %</TableHead>
                        <TableHead className="min-w-[120px] text-right">Celkem</TableHead>
                        <TableHead className="w-12" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {selectedDocument.items.length === 0 ? (
                        <TableRow><TableCell colSpan={8} className="h-24 text-center text-muted-foreground">Zatim bez polozek.</TableCell></TableRow>
                      ) : selectedDocument.items.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell><Input value={item.code || ''} onChange={(event) => updateItem(item.id, 'code', event.target.value)} disabled={!canEdit || saving} /></TableCell>
                          <TableCell><Input value={item.name || ''} onChange={(event) => updateItem(item.id, 'name', event.target.value)} disabled={!canEdit || saving} /></TableCell>
                          <TableCell><Input className="text-right" type="number" value={item.quantity || 0} onChange={(event) => updateItem(item.id, 'quantity', event.target.value)} disabled={!canEdit || saving} /></TableCell>
                          <TableCell><Input value={item.unit || 'ks'} onChange={(event) => updateItem(item.id, 'unit', event.target.value)} disabled={!canEdit || saving} /></TableCell>
                          <TableCell><Input className="text-right" type="number" value={item.unit_price || 0} onChange={(event) => updateItem(item.id, 'unit_price', event.target.value)} disabled={!canEdit || saving} /></TableCell>
                          <TableCell><Input className="text-right" type="number" value={item.discount_percent || 0} onChange={(event) => updateItem(item.id, 'discount_percent', event.target.value)} disabled={!canEdit || saving} /></TableCell>
                          <TableCell className="text-right font-semibold">{formatCurrency(calculateLineTotal(item))}</TableCell>
                          <TableCell>
                            <Button variant="ghost" size="icon" onClick={() => removeItem(item.id)} disabled={!canEdit || saving}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="app-page-wide space-y-6">
      <PageHeader
        icon={Icon}
        title={config.title}
        description="Tabulkovy seznam CRM dokumentu napojenych na obchodni pripady."
        actions={(
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={fetchData} disabled={loading}>
              <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} />
              Obnovit
            </Button>
            <Button onClick={handleCreateDocument} disabled={!canEdit || saving || opportunities.length === 0}>
              <Plus className="mr-2 h-4 w-4" />
              {config.createLabel}
            </Button>
          </div>
        )}
      />

      <Card className="crm-panel">
        <CardHeader className="crm-panel-header">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle>Prehled</CardTitle>
              <CardDescription>{filteredDocuments.length} zaznamu</CardDescription>
            </div>
            <div className="relative w-full lg:w-80">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Hledat cislo, klienta, OP..." className="pl-9" />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="crm-table-wrap">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[120px]">Kod</TableHead>
                  <TableHead className="min-w-[280px]">Predmet</TableHead>
                  <TableHead className="min-w-[180px]">Klient</TableHead>
                  <TableHead className="min-w-[190px]">Obchodni pripad</TableHead>
                  <TableHead className="min-w-[110px]">Vytvoreno</TableHead>
                  <TableHead className="min-w-[110px]">Stav</TableHead>
                  <TableHead className="min-w-[130px] text-right">Konecna cena</TableHead>
                  <TableHead className="min-w-[130px]">Konec platnosti</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={9} className="h-24 text-center text-muted-foreground">Nacitam...</TableCell></TableRow>
                ) : filteredDocuments.length === 0 ? (
                  <TableRow><TableCell colSpan={9} className="h-24 text-center text-muted-foreground">Zadne zaznamy.</TableCell></TableRow>
                ) : filteredDocuments.map((document) => (
                  <TableRow key={document.id} className="cursor-pointer" onClick={() => navigate(config.detailPath(document.id))}>
                    <TableCell className="font-semibold text-slate-950">{document.number || '-'}</TableCell>
                    <TableCell className="max-w-[360px] truncate">{document.title}</TableCell>
                    <TableCell className="font-medium">{document.subject?.name || document.opportunity?.subject?.name || '-'}</TableCell>
                    <TableCell>
                      <span className="text-muted-foreground">{document.opportunity?.number || 'OP'}</span>
                      <span className="ml-1">{document.opportunity?.title || ''}</span>
                    </TableCell>
                    <TableCell>{formatDate(document.created_at)}</TableCell>
                    <TableCell><Badge variant="outline">{documentStatuses.find((status) => status.value === document.status)?.label || document.status}</Badge></TableCell>
                    <TableCell className="text-right font-semibold">{formatCurrency(document.total)}</TableCell>
                    <TableCell>{formatDate(document.valid_until)}</TableCell>
                    <TableCell>
                      <Button asChild variant="ghost" size="icon" onClick={(event) => event.stopPropagation()}>
                        <Link to={config.detailPath(document.id)}>
                          <FileText className="h-4 w-4" />
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default CRMCommercialDocuments;
