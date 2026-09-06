import React, { useCallback, useEffect, useState } from 'react';
import { Database, FileText, Plus, Save, SlidersHorizontal, Target, Trash2 } from 'lucide-react';
import PageHeader from '@/components/ui/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
import {
  DEFAULT_CRM_NUMBERING,
  formatCrmNumber,
  normalizeCrmNumbering,
  selectCrmNumberingSettings,
  upsertCrmNumberingSettings,
} from '@/lib/crmNumbering';
import OrderTemplateManager from '@/components/OrderTemplateManager';
import RaynetImportManager from '@/components/RaynetImportManager';

const DEFAULT_STAGE_CONFIG = [
  { value: 'lead', label: 'Lead', color: 'bg-slate-100 text-slate-700 border-slate-200', probability: 10, sort_order: 10, is_active: true, is_closed: false },
  { value: 'qualified', label: 'Kvalifikováno', color: 'bg-blue-100 text-blue-700 border-blue-200', probability: 25, sort_order: 20, is_active: true, is_closed: false },
  { value: 'proposal', label: 'Nabídka', color: 'bg-indigo-100 text-indigo-700 border-indigo-200', probability: 45, sort_order: 30, is_active: true, is_closed: false },
  { value: 'negotiation', label: 'Jednání', color: 'bg-amber-100 text-amber-800 border-amber-200', probability: 70, sort_order: 40, is_active: true, is_closed: false },
  { value: 'won', label: 'Vyhráno', color: 'bg-emerald-100 text-emerald-700 border-emerald-200', probability: 100, sort_order: 50, is_active: true, is_closed: true },
  { value: 'lost', label: 'Ztraceno', color: 'bg-rose-100 text-rose-700 border-rose-200', probability: 0, sort_order: 60, is_active: true, is_closed: true },
];

const DEFAULT_PRIORITY_CONFIG = [
  { value: 'low', label: 'Nízká', tone: 'secondary', sort_order: 10, is_active: true },
  { value: 'medium', label: 'Střední', tone: 'outline', sort_order: 20, is_active: true },
  { value: 'high', label: 'Vysoká', tone: 'destructive', sort_order: 30, is_active: true },
];

const DEFAULT_PRODUCT_FIELD_DEFINITIONS = [
  { field_key: 'manufacturer', label: 'Výrobce', field_type: 'text', field_group: 'Identifikace', unit: '', ai_hint: 'Najdi výrobce nebo brand produktu v datasheetu.', is_required: false, is_active: true, sort_order: 10, options_text: '' },
  { field_key: 'model', label: 'Model', field_type: 'text', field_group: 'Identifikace', unit: '', ai_hint: 'Najdi přesné modelové označení produktu.', is_required: false, is_active: true, sort_order: 20, options_text: '' },
  { field_key: 'power_wp', label: 'Výkon', field_type: 'number', field_group: 'Technické parametry', unit: 'Wp', ai_hint: 'Jmenovitý výkon panelu nebo zařízení.', is_required: false, is_active: true, sort_order: 30, options_text: '' },
];

const DEFAULT_CRM_CUSTOM_SECTIONS = [
  {
    business_type: 'fve',
    title: 'Fakturace',
    description: 'Fakturacni a platebni udaje obchodniho pripadu.',
    sort_order: 10,
    is_active: true,
    fields: [
      { field_key: 'invoice_mode', label: 'Rezim fakturace', field_type: 'select', template_key: 'invoice_mode', options: ['zaloha', 'po etapach', 'po predani'], is_required: false, is_active: true, sort_order: 10 },
    ],
  },
  {
    business_type: 'fve',
    title: 'Identifikace nemovitosti',
    description: 'Adresa, parcela a zakladni parametry instalace.',
    sort_order: 20,
    is_active: true,
    fields: [
      { field_key: 'installation_address', label: 'Adresa instalace', field_type: 'textarea', template_key: 'installation_address', options: [], is_required: false, is_active: true, sort_order: 10 },
      { field_key: 'parcel_number', label: 'Parcelni cislo', field_type: 'text', template_key: 'parcel_number', options: [], is_required: false, is_active: true, sort_order: 20 },
    ],
  },
  {
    business_type: 'fve',
    title: 'Konfigurace FVE',
    description: 'Technicke parametry elektrarny.',
    sort_order: 30,
    is_active: true,
    fields: [
      { field_key: 'system_power_kwp', label: 'Vykon FVE kWp', field_type: 'number', template_key: 'system_power_kwp', options: [], is_required: false, is_active: true, sort_order: 10 },
      { field_key: 'panel_count', label: 'Pocet panelu', field_type: 'number', template_key: 'panel_count', options: [], is_required: false, is_active: true, sort_order: 20 },
      { field_key: 'inverter_type', label: 'Typ stridace', field_type: 'text', template_key: 'inverter_type', options: [], is_required: false, is_active: true, sort_order: 30 },
      { field_key: 'battery_capacity_kwh', label: 'Kapacita baterie kWh', field_type: 'number', template_key: 'battery_capacity_kwh', options: [], is_required: false, is_active: true, sort_order: 40 },
    ],
  },
  {
    business_type: 'pd',
    title: 'Projektova dokumentace',
    description: 'Stupen projektu, urady, terminy a odpovednosti.',
    sort_order: 10,
    is_active: true,
    fields: [
      { field_key: 'project_stage', label: 'Stupen dokumentace', field_type: 'select', template_key: 'project_stage', options: ['studie', 'DSP', 'DPS', 'realizacni dokumentace'], is_required: false, is_active: true, sort_order: 10 },
    ],
  },
];

const normalizeStages = (stages) => (
  (stages?.length ? stages : DEFAULT_STAGE_CONFIG).map((stage, index) => ({
    ...stage,
    probability: Number(stage.probability || 0),
    sort_order: Number(stage.sort_order ?? ((index + 1) * 10)),
    is_active: stage.is_active ?? true,
    is_closed: Boolean(stage.is_closed),
  }))
);

const normalizePriorities = (priorities) => (
  (priorities?.length ? priorities : DEFAULT_PRIORITY_CONFIG).map((priority, index) => ({
    ...priority,
    sort_order: Number(priority.sort_order ?? ((index + 1) * 10)),
    is_active: priority.is_active ?? true,
  }))
);


const normalizeCustomSections = (sections) => (
  (sections?.length ? sections : DEFAULT_CRM_CUSTOM_SECTIONS).map((section, index) => ({
    id: section.id || null,
    business_type: section.business_type || 'general',
    title: section.title || 'Sekce',
    description: section.description || '',
    sort_order: Number(section.sort_order ?? ((index + 1) * 10)),
    is_active: section.is_active ?? true,
    fields: (section.fields?.length ? section.fields : []).map((field, fieldIndex) => ({
      id: field.id || null,
      field_key: normalizeFieldKey(field.field_key) || `field_${fieldIndex + 1}`,
      label: field.label || field.field_key || 'Pole',
      field_type: field.field_type || 'text',
      template_key: normalizeFieldKey(field.template_key || field.field_key),
      options_text: field.options_text ?? (Array.isArray(field.options) ? field.options.join(', ') : ''),
      is_required: Boolean(field.is_required),
      is_active: field.is_active ?? true,
      sort_order: Number(field.sort_order ?? ((fieldIndex + 1) * 10)),
    })),
  }))
);

const normalizeFieldKey = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9_]+/g, '_')
  .replace(/^_+|_+$/g, '');

const normalizeProductFields = (fields) => (
  (fields?.length ? fields : DEFAULT_PRODUCT_FIELD_DEFINITIONS).map((field, index) => ({
    id: field.id || null,
    field_key: normalizeFieldKey(field.field_key) || `field_${index + 1}`,
    label: field.label || field.field_key || 'Pole',
    field_type: field.field_type || 'text',
    field_group: field.field_group || 'Technicke parametry',
    unit: field.unit || '',
    ai_hint: field.ai_hint || '',
    is_required: Boolean(field.is_required),
    is_active: field.is_active ?? true,
    sort_order: Number(field.sort_order ?? ((index + 1) * 10)),
    options_text: field.options_text ?? (Array.isArray(field.options) ? field.options.join(', ') : ''),
  }))
);

const SettingsCRM = () => {
  const { hasPermission } = useAuth();
  const { toast } = useToast();
  const [crmStages, setCrmStages] = useState(() => normalizeStages(DEFAULT_STAGE_CONFIG));
  const [crmPriorities, setCrmPriorities] = useState(() => normalizePriorities(DEFAULT_PRIORITY_CONFIG));
  const [crmNumbering, setCrmNumbering] = useState(() => normalizeCrmNumbering(Object.values(DEFAULT_CRM_NUMBERING)));
  const [productFields, setProductFields] = useState(() => normalizeProductFields(DEFAULT_PRODUCT_FIELD_DEFINITIONS));
  const [removedProductFields, setRemovedProductFields] = useState([]);
  const [productFieldsReady, setProductFieldsReady] = useState(true);
  const [customSections, setCustomSections] = useState(() => normalizeCustomSections(DEFAULT_CRM_CUSTOM_SECTIONS));
  const [customSectionsReady, setCustomSectionsReady] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeSection, setActiveSection] = useState('documents');

  const canAdmin = hasPermission('settings', 'can_admin');
  const activeSectionMeta = {
    documents: {
      title: 'Dokumenty',
      saveLabel: 'Uložit dokumentová nastavení',
      description: 'Uloží číslování CRM dokumentů. Šablony se ukládají samostatně v knihovně šablon.',
    },
    pipeline: {
      title: 'Pipeline',
      saveLabel: 'Uložit pipeline',
      description: 'Uloží stavy obchodních případů a priority.',
    },
    products: {
      title: 'Produkty',
      saveLabel: 'Uložit produktová pole',
      description: 'Uloží definice produktových polí pro katalog, AI extrakci a dokumenty.',
    },
    customFields: {
      title: 'Volitelná pole OP',
      saveLabel: 'Uložit volitelná pole',
      description: 'Uloží sekce a pole pro detail obchodního případu a dokumentové šablony.',
    },
    integrations: {
      title: 'Raynet import',
      saveLabel: '',
      description: 'Připojení, mapování, náhled a řízený import původních CRM dat.',
    },
  }[activeSection];

  const fetchCrmConfig = useCallback(async () => {
    if (!canAdmin) {
      setLoading(false);
      return;
    }

    setLoading(true);
    const [stagesRes, prioritiesRes, numberingRes, productFieldsRes, customSectionsRes] = await Promise.all([
      supabase
        .from('crm_stage_definitions')
        .select('value, label, color, probability, sort_order, is_active, is_closed')
        .eq('is_active', true)
        .order('sort_order', { ascending: true }),
      supabase
        .from('crm_priority_definitions')
        .select('value, label, tone, sort_order, is_active')
        .eq('is_active', true)
        .order('sort_order', { ascending: true }),
      selectCrmNumberingSettings(supabase),
      supabase
        .from('product_field_definitions')
        .select('id, field_key, label, field_type, field_group, unit, options, ai_hint, is_required, is_active, sort_order')
        .eq('is_active', true)
        .order('sort_order', { ascending: true }),
      supabase
        .from('crm_custom_field_sections')
        .select('id, business_type, title, description, sort_order, is_active, fields:crm_custom_field_definitions(id, field_key, label, field_type, template_key, options, is_required, is_active, sort_order)')
        .eq('is_active', true)
        .order('sort_order', { ascending: true }),
    ]);

    const error = stagesRes.error || prioritiesRes.error;
    if (error) {
      toast({
        title: 'CRM nastavení se nepodařilo načíst',
        description: error.message,
        variant: 'destructive',
      });
    } else {
      setCrmStages(normalizeStages(stagesRes.data));
      setCrmPriorities(normalizePriorities(prioritiesRes.data));
      setCrmNumbering(normalizeCrmNumbering(numberingRes.error ? [] : numberingRes.data));
      setProductFieldsReady(!productFieldsRes.error);
      setProductFields(normalizeProductFields(productFieldsRes.error ? DEFAULT_PRODUCT_FIELD_DEFINITIONS : productFieldsRes.data));
      setRemovedProductFields([]);
      setCustomSectionsReady(!customSectionsRes.error);
      setCustomSections(normalizeCustomSections(customSectionsRes.error ? DEFAULT_CRM_CUSTOM_SECTIONS : customSectionsRes.data));
    }
    setLoading(false);
  }, [canAdmin, toast]);

  useEffect(() => {
    fetchCrmConfig();
  }, [fetchCrmConfig]);

  const updateStageConfig = (index, field, value) => {
    setCrmStages((current) => current.map((stage, stageIndex) => (
      stageIndex === index ? { ...stage, [field]: field === 'probability' ? Number(value || 0) : value } : stage
    )));
  };

  const updatePriorityConfig = (index, field, value) => {
    setCrmPriorities((current) => current.map((priority, priorityIndex) => (
      priorityIndex === index ? { ...priority, [field]: value } : priority
    )));
  };

  const updateProductField = (index, field, value) => {
    setProductFields((current) => current.map((definition, definitionIndex) => {
      if (definitionIndex !== index) return definition;
      const nextValue = field === 'field_key' ? normalizeFieldKey(value) : value;
      return { ...definition, [field]: nextValue };
    }));
  };

  const addStageConfig = () => {
    setCrmStages((current) => ([
      ...current,
      {
        value: `stage_${Date.now()}`,
        label: 'Nový stav',
        color: 'bg-slate-100 text-slate-700 border-slate-200',
        probability: 50,
        sort_order: (current.length + 1) * 10,
        is_active: true,
        is_closed: false,
      },
    ]));
  };

  const addPriorityConfig = () => {
    setCrmPriorities((current) => ([
      ...current,
      { value: `priority_${Date.now()}`, label: 'Nová priorita', tone: 'secondary', sort_order: (current.length + 1) * 10, is_active: true },
    ]));
  };

  const addProductField = () => {
    setProductFields((current) => ([
      ...current,
      {
        id: null,
        field_key: `field_${Date.now()}`,
        label: 'Nové pole',
        field_type: 'text',
        field_group: 'Technické parametry',
        unit: '',
        options_text: '',
        ai_hint: '',
        is_required: false,
        is_active: true,
        sort_order: (current.length + 1) * 10,
      },
    ]));
  };

  const removeProductField = (index) => {
    setProductFields((current) => {
      const field = current[index];
      if (field?.id || field?.field_key) {
        setRemovedProductFields((removed) => ([...removed, { ...field, is_active: false }]));
      }
      return current.filter((_, fieldIndex) => fieldIndex !== index);
    });
  };


  const updateCustomSection = (sectionIndex, field, value) => {
    setCustomSections((current) => current.map((section, index) => (index === sectionIndex ? { ...section, [field]: value } : section)));
  };

  const updateCustomField = (sectionIndex, fieldIndex, field, value) => {
    setCustomSections((current) => current.map((section, index) => {
      if (index !== sectionIndex) return section;
      return { ...section, fields: section.fields.map((definition, definitionIndex) => (definitionIndex === fieldIndex ? { ...definition, [field]: field === 'field_key' || field === 'template_key' ? normalizeFieldKey(value) : value } : definition)) };
    }));
  };

  const addCustomSection = () => setCustomSections((current) => ([...current, { id: null, business_type: 'general', title: 'Nova sekce', description: '', sort_order: (current.length + 1) * 10, is_active: true, fields: [] }]));

  const addCustomField = (sectionIndex) => setCustomSections((current) => current.map((section, index) => (index === sectionIndex ? { ...section, fields: [...section.fields, { id: null, field_key: `field_${Date.now()}`, label: 'Nove pole', field_type: 'text', template_key: `field_${Date.now()}`, options_text: '', sort_order: (section.fields.length + 1) * 10, is_active: true }] } : section)));

  const removeCustomField = (sectionIndex, fieldIndex) => setCustomSections((current) => current.map((section, index) => (index === sectionIndex ? { ...section, fields: section.fields.filter((_, currentFieldIndex) => currentFieldIndex !== fieldIndex) } : section)));

  const updateNumberingConfig = (type, field, value) => {
    setCrmNumbering((current) => ({
      ...current,
      [type]: {
        ...current[type],
        [field]: field === 'prefix'
          ? value.toUpperCase().replace(/[^A-Z0-9_-]/g, '')
          : field === 'year_format'
            ? value
            : Number(value || 1),
      },
    }));
  };

  const resetCrmConfig = () => {
    setCrmStages(normalizeStages(DEFAULT_STAGE_CONFIG));
    setCrmPriorities(normalizePriorities(DEFAULT_PRIORITY_CONFIG));
  };

  const handleSaveCrmConfig = async () => {
    if (!canAdmin) return;

    setSaving(true);

    const stageRows = crmStages.map((stage, index) => ({
      value: stage.value,
      label: stage.label.trim() || stage.value,
      color: stage.color || 'bg-slate-100 text-slate-700 border-slate-200',
      probability: Math.min(100, Math.max(0, Number(stage.probability || 0))),
      sort_order: (index + 1) * 10,
      is_active: true,
      is_closed: Boolean(stage.is_closed),
    }));

    const priorityRows = crmPriorities.map((priority, index) => ({
      value: priority.value,
      label: priority.label.trim() || priority.value,
      tone: priority.tone || 'secondary',
      sort_order: (index + 1) * 10,
      is_active: true,
    }));

    const numberingRows = Object.values(crmNumbering).map((config) => ({
      document_type: config.document_type,
      prefix: String(config.prefix || '').trim().toUpperCase() || DEFAULT_CRM_NUMBERING[config.document_type]?.prefix || 'DOC',
      next_number: Math.max(1, Number(config.next_number || 1)),
      padding: Math.max(2, Number(config.padding || 3)),
      year_format: ['YY', 'YYYY', 'NONE'].includes(config.year_format) ? config.year_format : 'YY',
    }));

    const productFieldRows = [
      ...productFields.map((field, index) => ({
        id: field.id || undefined,
        field_key: normalizeFieldKey(field.field_key) || `field_${index + 1}`,
        label: field.label.trim() || field.field_key || 'Pole',
        field_type: field.field_type || 'text',
        field_group: field.field_group.trim() || 'Technické parametry',
        unit: field.unit?.trim() || null,
        options: field.field_type === 'select'
          ? String(field.options_text || '').split(',').map((option) => option.trim()).filter(Boolean)
          : [],
        ai_hint: field.ai_hint?.trim() || null,
        is_required: Boolean(field.is_required),
        is_active: true,
        sort_order: (index + 1) * 10,
      })),
      ...removedProductFields.map((field) => ({
        id: field.id || undefined,
        field_key: normalizeFieldKey(field.field_key),
        label: field.label || field.field_key,
        field_type: field.field_type || 'text',
        field_group: field.field_group || 'Technické parametry',
        unit: field.unit || null,
        options: [],
        ai_hint: field.ai_hint || null,
        is_required: Boolean(field.is_required),
        is_active: false,
        sort_order: Number(field.sort_order || 999),
      })),
    ].filter((field) => field.field_key);


    let customFieldsError = null;
    if (customSectionsReady) {
      const sectionRows = customSections.map((section, index) => ({ id: section.id || undefined, business_type: section.business_type || 'general', title: section.title.trim() || 'Sekce', description: section.description?.trim() || null, sort_order: (index + 1) * 10, is_active: true }));
      const { data: savedSections, error: sectionsError } = await supabase.from('crm_custom_field_sections').upsert(sectionRows, { onConflict: 'business_type,title' }).select('id, business_type, title');
      customFieldsError = sectionsError;
      if (!customFieldsError) {
        const sectionIdByKey = new Map((savedSections || []).map((section) => [`${section.business_type}:${section.title}`, section.id]));
        const fieldRows = customSections.flatMap((section) => {
          const sectionId = section.id || sectionIdByKey.get(`${section.business_type || 'general'}:${section.title.trim() || 'Sekce'}`);
          if (!sectionId) return [];
          return section.fields.map((field, index) => ({ id: field.id || undefined, section_id: sectionId, field_key: normalizeFieldKey(field.field_key) || `field_${index + 1}`, label: field.label.trim() || field.field_key || 'Pole', field_type: field.field_type || 'text', template_key: normalizeFieldKey(field.template_key || field.field_key) || null, options: field.field_type === 'select' ? String(field.options_text || '').split(',').map((option) => option.trim()).filter(Boolean) : [], is_required: Boolean(field.is_required), is_active: true, sort_order: (index + 1) * 10 }));
        });
        if (fieldRows.length > 0) {
          const { error: fieldsError } = await supabase.from('crm_custom_field_definitions').upsert(fieldRows, { onConflict: 'section_id,field_key' });
          customFieldsError = fieldsError;
        }
      }
    }

    const { error: stagesError } = await supabase
      .from('crm_stage_definitions')
      .upsert(stageRows, { onConflict: 'value' });

    const { error: prioritiesError } = stagesError ? { error: null } : await supabase
      .from('crm_priority_definitions')
      .upsert(priorityRows, { onConflict: 'value' });

    const { error: numberingError } = (stagesError || prioritiesError) ? { error: null } : await upsertCrmNumberingSettings(supabase, numberingRows);

    const { error: productFieldsError } = (stagesError || prioritiesError || numberingError || !productFieldsReady) ? { error: null } : await supabase
      .from('product_field_definitions')
      .upsert(productFieldRows, { onConflict: 'field_key' });

    setSaving(false);

    const error = customFieldsError || stagesError || prioritiesError || numberingError || productFieldsError;
    if (error) {
      toast({
        title: 'CRM nastavení se nepodařilo uložit',
        description: error.message,
        variant: 'destructive',
      });
      return;
    }

    setCrmStages(normalizeStages(stageRows));
    setCrmPriorities(normalizePriorities(priorityRows));
    setCrmNumbering(normalizeCrmNumbering(numberingRows));
    setProductFields(normalizeProductFields(productFieldRows.filter((field) => field.is_active)));
    setRemovedProductFields([]);
    toast({ title: 'CRM nastavení uloženo' });
    fetchCrmConfig();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Target}
        title="CRM nastavení"
        description="Správa stavů obchodních případů, pravděpodobnosti a priorit pro CRM pipeline."
      />

      {!canAdmin && (
        <Alert>
          <SlidersHorizontal className="h-4 w-4" />
          <AlertTitle>Nedostatečná oprávnění</AlertTitle>
          <AlertDescription>Tuto část nastavení může měnit pouze administrátor.</AlertDescription>
        </Alert>
      )}

      <Tabs value={activeSection} onValueChange={setActiveSection} className="w-full">
        <TabsList className="flex h-auto w-full justify-start gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-sm">
          {[
            ['documents', FileText, 'Dokumenty'],
            ['pipeline', Target, 'Pipeline'],
            ['products', SlidersHorizontal, 'Produkty'],
            ['customFields', SlidersHorizontal, 'Volitelna pole OP'],
            ['integrations', Database, 'Raynet import'],
          ].map(([value, Icon, label]) => (
            <TabsTrigger
              key={value}
              value={value}
              className="h-10 rounded-lg border-0 px-4 text-sm font-semibold text-slate-600 data-[state=active]:bg-primary data-[state=active]:text-white data-[state=active]:shadow-sm"
            >
              <Icon className="mr-2 h-4 w-4" />
              {label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="documents" className="space-y-6">
          <Card>
            <CardHeader className="border-b bg-slate-50/70">
              <CardTitle>Číslování CRM dokumentů</CardTitle>
              <CardDescription>Prefixy a další číslo pro obchodní případy, nabídky a objednávky.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 p-4 xl:grid-cols-3">
              {Object.values(crmNumbering).map((config) => (
                <div key={config.document_type} className="rounded-lg border bg-white p-3 shadow-sm">
                  <div className="mb-3">
                    <div className="text-sm font-semibold text-slate-900">{config.label}</div>
                    <div className="text-xs text-muted-foreground">Příklad: {formatCrmNumber(crmNumbering, config.document_type)}</div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="space-y-2">
                      <Label>Prefix</Label>
                      <Input value={config.prefix} onChange={(event) => updateNumberingConfig(config.document_type, 'prefix', event.target.value)} disabled={loading || saving || !canAdmin} />
                    </div>
                    <div className="space-y-2">
                      <Label>Rok v čísle</Label>
                      <Select value={config.year_format || 'YY'} onValueChange={(value) => updateNumberingConfig(config.document_type, 'year_format', value)} disabled={loading || saving || !canAdmin}>
                        <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="YY">Krátký rok (26)</SelectItem>
                          <SelectItem value="YYYY">Celý rok (2026)</SelectItem>
                          <SelectItem value="NONE">Bez roku</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Další číslo</Label>
                      <Input type="number" min="1" value={config.next_number} onChange={(event) => updateNumberingConfig(config.document_type, 'next_number', event.target.value)} disabled={loading || saving || !canAdmin} />
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <OrderTemplateManager embedded />
        </TabsContent>

        <TabsContent value="pipeline" className="space-y-6">
          <Card>
            <CardHeader className="gap-4 border-b bg-slate-50/70">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                <div>
                  <CardTitle>Stavy obchodního případu</CardTitle>
                  <CardDescription>Hodnoty používané v CRM pipeline a ve formuláři příležitosti.</CardDescription>
                </div>
                <Button type="button" variant="outline" onClick={addStageConfig} disabled={loading || saving || !canAdmin}>Přidat stav</Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 p-4">
              {crmStages.map((stage, index) => (
                <div key={stage.value} className="grid gap-3 rounded-lg border bg-white p-3 shadow-sm md:grid-cols-[minmax(140px,1fr)_110px_minmax(190px,1.2fr)_120px]">
                  <div className="space-y-2">
                    <Label>Název</Label>
                    <Input value={stage.label} onChange={(event) => updateStageConfig(index, 'label', event.target.value)} disabled={loading || saving || !canAdmin} />
                  </div>
                  <div className="space-y-2">
                    <Label>Pravděp.</Label>
                    <Input type="number" min="0" max="100" value={stage.probability} onChange={(event) => updateStageConfig(index, 'probability', event.target.value)} disabled={loading || saving || !canAdmin} />
                  </div>
                  <div className="space-y-2">
                    <Label>Barva</Label>
                    <Select value={stage.color} onValueChange={(value) => updateStageConfig(index, 'color', value)} disabled={loading || saving || !canAdmin}>
                      <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="bg-slate-100 text-slate-700 border-slate-200">Neutral</SelectItem>
                        <SelectItem value="bg-blue-100 text-blue-700 border-blue-200">Modrá</SelectItem>
                        <SelectItem value="bg-indigo-100 text-indigo-700 border-indigo-200">Indigo</SelectItem>
                        <SelectItem value="bg-amber-100 text-amber-800 border-amber-200">Oranžová</SelectItem>
                        <SelectItem value="bg-emerald-100 text-emerald-700 border-emerald-200">Zelená</SelectItem>
                        <SelectItem value="bg-rose-100 text-rose-700 border-rose-200">Červená</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Typ</Label>
                    <Select value={stage.is_closed ? 'closed' : 'open'} onValueChange={(value) => updateStageConfig(index, 'is_closed', value === 'closed')} disabled={loading || saving || !canAdmin}>
                      <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="open">Otevřeno</SelectItem>
                        <SelectItem value="closed">Uzavřeno</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="gap-4 border-b bg-slate-50/70">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                <div>
                  <CardTitle>Priority</CardTitle>
                  <CardDescription>Priority se zobrazují v kartách pipeline a ve formuláři příležitosti.</CardDescription>
                </div>
                <Button type="button" variant="outline" onClick={addPriorityConfig} disabled={loading || saving || !canAdmin}>Přidat prioritu</Button>
              </div>
            </CardHeader>
            <CardContent className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
              {crmPriorities.map((priority, index) => (
                <div key={priority.value} className="grid gap-3 rounded-lg border bg-white p-3 shadow-sm sm:grid-cols-[minmax(0,1fr)_140px] xl:grid-cols-1">
                  <div className="space-y-2">
                    <Label>Název</Label>
                    <Input value={priority.label} onChange={(event) => updatePriorityConfig(index, 'label', event.target.value)} disabled={loading || saving || !canAdmin} />
                  </div>
                  <div className="space-y-2">
                    <Label>Vzhled</Label>
                    <Select value={priority.tone} onValueChange={(value) => updatePriorityConfig(index, 'tone', value)} disabled={loading || saving || !canAdmin}>
                      <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="secondary">Neutral</SelectItem>
                        <SelectItem value="outline">Obrys</SelectItem>
                        <SelectItem value="destructive">Výrazná</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="products" className="space-y-6">
          <Card>
            <CardHeader className="gap-4 border-b bg-slate-50/70">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                <div>
                  <CardTitle>Produktová pole</CardTitle>
                  <CardDescription>Definice technických a obchodních polí produktu pro katalog, AI extrakci a dokumenty.</CardDescription>
                </div>
                <Button type="button" variant="outline" onClick={addProductField} disabled={loading || saving || !canAdmin}>
                  <Plus className="mr-2 h-4 w-4" />
                  Přidat pole
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 p-4">
              {!productFieldsReady && (
                <Alert className="border-amber-200 bg-amber-50 text-amber-900">
                  <SlidersHorizontal className="h-4 w-4" />
                  <AlertTitle>Produktová pole zatím nejsou v databázi</AlertTitle>
                  <AlertDescription>Aplikujte produktovou migraci. Do té doby se zobrazují jen výchozí pole a nejdou uložit online.</AlertDescription>
                </Alert>
              )}
              {productFields.map((field, index) => (
                <div key={`${field.field_key}-${index}`} className="grid gap-3 rounded-lg border bg-white p-3 shadow-sm xl:grid-cols-[1fr_160px_150px_120px_1.4fr_44px]">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Název</Label>
                      <Input value={field.label} onChange={(event) => updateProductField(index, 'label', event.target.value)} disabled={loading || saving || !canAdmin} />
                    </div>
                    <div className="space-y-2">
                      <Label>Klíč pro AI / template</Label>
                      <Input value={field.field_key} onChange={(event) => updateProductField(index, 'field_key', event.target.value)} disabled={loading || saving || !canAdmin} className="font-mono" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Typ</Label>
                    <Select value={field.field_type} onValueChange={(value) => updateProductField(index, 'field_type', value)} disabled={loading || saving || !canAdmin}>
                      <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="text">Text</SelectItem>
                        <SelectItem value="textarea">Dlouhý text</SelectItem>
                        <SelectItem value="number">Číslo</SelectItem>
                        <SelectItem value="boolean">Ano / ne</SelectItem>
                        <SelectItem value="date">Datum</SelectItem>
                        <SelectItem value="select">Výběr</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Skupina</Label>
                    <Input value={field.field_group} onChange={(event) => updateProductField(index, 'field_group', event.target.value)} disabled={loading || saving || !canAdmin} />
                  </div>
                  <div className="space-y-2">
                    <Label>Jednotka</Label>
                    <Input value={field.unit || ''} onChange={(event) => updateProductField(index, 'unit', event.target.value)} disabled={loading || saving || !canAdmin} placeholder="Wp, kg, V..." />
                  </div>
                  <div className="space-y-2">
                    <Label>{field.field_type === 'select' ? 'Možnosti / AI nápověda' : 'AI nápověda'}</Label>
                    {field.field_type === 'select' && (
                      <Input value={field.options_text || ''} onChange={(event) => updateProductField(index, 'options_text', event.target.value)} disabled={loading || saving || !canAdmin} placeholder="Hodnota 1, Hodnota 2" className="mb-2" />
                    )}
                    <Input value={field.ai_hint || ''} onChange={(event) => updateProductField(index, 'ai_hint', event.target.value)} disabled={loading || saving || !canAdmin} placeholder="Co má AI hledat v datasheetu" />
                  </div>
                  <div className="flex items-end justify-end">
                    <Button type="button" variant="ghost" size="icon" aria-label={`Odebrat produktové pole ${field.label || field.field_key || index + 1}`} onClick={() => removeProductField(index)} disabled={loading || saving || !canAdmin}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="customFields" className="space-y-6">
          <Card>
            <CardHeader className="gap-4 border-b bg-slate-50/70">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                <div>
                  <CardTitle>Volitelna pole OP</CardTitle>
                  <CardDescription>Sekce a pole podle typu obchodniho pripadu. Template klic lze pouzit v sablonach dokumentu.</CardDescription>
                </div>
                <Button type="button" variant="outline" onClick={addCustomSection} disabled={loading || saving || !canAdmin || !customSectionsReady}>
                  <Plus className="mr-2 h-4 w-4" />
                  Pridat sekci
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 p-4">
              {!customSectionsReady && (
                <Alert className="border-amber-200 bg-amber-50 text-amber-900">
                  <SlidersHorizontal className="h-4 w-4" />
                  <AlertTitle>Volitelna pole zatim nejsou v databazi</AlertTitle>
                  <AlertDescription>Aplikujte CRM Raynet migraci. Do te doby se zobrazuji vychozi sekce bez online ulozeni.</AlertDescription>
                </Alert>
              )}
              {customSections.map((section, sectionIndex) => (
                <div key={`${section.title}-${sectionIndex}`} className="rounded-lg border bg-white p-3 shadow-sm">
                  <div className="grid gap-3 xl:grid-cols-[150px_220px_minmax(0,1fr)_auto]">
                    <div className="space-y-2">
                      <Label>Typ OP</Label>
                      <Select value={section.business_type} onValueChange={(value) => updateCustomSection(sectionIndex, 'business_type', value)} disabled={loading || saving || !canAdmin || !customSectionsReady}>
                        <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="general">Obecne</SelectItem>
                          <SelectItem value="fve">FVE</SelectItem>
                          <SelectItem value="pd">PD</SelectItem>
                          <SelectItem value="hw">HW</SelectItem>
                          <SelectItem value="service">Servis</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Nazev sekce</Label>
                      <Input value={section.title} onChange={(event) => updateCustomSection(sectionIndex, 'title', event.target.value)} disabled={loading || saving || !canAdmin || !customSectionsReady} />
                    </div>
                    <div className="space-y-2">
                      <Label>Popis</Label>
                      <Textarea value={section.description || ''} onChange={(event) => updateCustomSection(sectionIndex, 'description', event.target.value)} disabled={loading || saving || !canAdmin || !customSectionsReady} className="min-h-[42px]" />
                    </div>
                    <div className="flex items-end">
                      <Button type="button" variant="outline" size="sm" onClick={() => addCustomField(sectionIndex)} disabled={loading || saving || !canAdmin || !customSectionsReady}>
                        <Plus className="mr-2 h-4 w-4" />Pole
                      </Button>
                    </div>
                  </div>
                  <div className="mt-3 space-y-2">
                    {section.fields.map((field, fieldIndex) => (
                      <div key={`${field.field_key}-${fieldIndex}`} className="grid gap-2 rounded-md border bg-slate-50 p-2 xl:grid-cols-[1fr_1fr_150px_1fr_44px]">
                        <Input value={field.label} onChange={(event) => updateCustomField(sectionIndex, fieldIndex, 'label', event.target.value)} disabled={loading || saving || !canAdmin || !customSectionsReady} placeholder="Nazev pole" />
                        <Input value={field.field_key} onChange={(event) => updateCustomField(sectionIndex, fieldIndex, 'field_key', event.target.value)} disabled={loading || saving || !canAdmin || !customSectionsReady} placeholder="field_key" className="font-mono" />
                        <Select value={field.field_type} onValueChange={(value) => updateCustomField(sectionIndex, fieldIndex, 'field_type', value)} disabled={loading || saving || !canAdmin || !customSectionsReady}>
                          <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="text">Text</SelectItem>
                            <SelectItem value="textarea">Dlouhy text</SelectItem>
                            <SelectItem value="number">Cislo</SelectItem>
                            <SelectItem value="date">Datum</SelectItem>
                            <SelectItem value="boolean">Ano / ne</SelectItem>
                            <SelectItem value="select">Vyber</SelectItem>
                            <SelectItem value="url">URL</SelectItem>
                            <SelectItem value="email">Email</SelectItem>
                          </SelectContent>
                        </Select>
                        <Input value={field.template_key || ''} onChange={(event) => updateCustomField(sectionIndex, fieldIndex, 'template_key', event.target.value)} disabled={loading || saving || !canAdmin || !customSectionsReady} placeholder="template_key" className="font-mono" />
                        <Button type="button" variant="ghost" size="icon" onClick={() => removeCustomField(sectionIndex, fieldIndex)} disabled={loading || saving || !canAdmin || !customSectionsReady}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="integrations" className="space-y-6">
          <RaynetImportManager />
        </TabsContent>
      </Tabs>

      {activeSection !== 'integrations' && (
      <div className="sticky bottom-4 z-10 flex flex-col gap-3 rounded-xl border border-slate-200 bg-white/95 p-4 shadow-lg backdrop-blur sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-sm font-semibold text-slate-950">{activeSectionMeta.title}</div>
          <div className="mt-1 text-sm text-slate-500">{activeSectionMeta.description}</div>
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
        {activeSection === 'pipeline' && (
          <Button type="button" variant="ghost" onClick={resetCrmConfig} disabled={loading || saving || !canAdmin}>
            Obnovit výchozí pipeline
          </Button>
        )}
        <Button type="button" onClick={handleSaveCrmConfig} disabled={loading || saving || !canAdmin}>
          <Save className="mr-2 h-4 w-4" />
          {saving ? 'Ukládám...' : activeSectionMeta.saveLabel}
        </Button>
        </div>
      </div>
      )}
    </div>
  );
};

export default SettingsCRM;
