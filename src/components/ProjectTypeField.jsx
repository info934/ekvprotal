import React, { useEffect, useId, useState } from 'react';
import { Plus, Pencil, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DEFAULT_PROJECT_PREFIX, normalizeProjectPrefix, saveProjectType, suggestProjectPrefix } from '@/lib/projectNumbering';

export default function ProjectTypeField({ value, onChange, canManage = false, disabled = false, onTypesChanged }) {
  const id = useId();
  const { toast } = useToast();
  const [types, setTypes] = useState([]);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let active = true;
    supabase.from('project_types').select('*').order('name').then(({ data, error: loadError }) => {
      if (!active) return;
      setTypes(data || []);
      setError(loadError ? 'Typy projektů se nepodařilo načíst.' : '');
    });
    return () => { active = false; };
  }, []);
  const selected = types.find(type => type.name === value);
  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      const saved = await saveProjectType(supabase, draft);
      setTypes(current => [...current.filter(type => type.id !== saved.id), saved].sort((a, b) => a.name.localeCompare(b.name)));
      onChange(saved.name);
      onTypesChanged?.();
      setDraft(null);
      toast({ title: 'Typ projektu a prefix uloženy' });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };
  return <div className="space-y-2">
    <Label htmlFor={id}>Typ projektu</Label>
    <div className="flex items-center gap-2">
      <Select value={value || '__default__'} onValueChange={next => { if (next) onChange(next === '__default__' ? '' : next); }} disabled={disabled || saving}>
        <SelectTrigger id={id} className="min-w-0 bg-white"><SelectValue placeholder="Ostatní" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="__default__">Bez typu · {DEFAULT_PROJECT_PREFIX}</SelectItem>
          {value && !selected && <SelectItem value={value}>{value}</SelectItem>}
          {types.map(type => <SelectItem key={type.id} value={type.name}>{type.name} · {type.code_prefix || DEFAULT_PROJECT_PREFIX}</SelectItem>)}
        </SelectContent>
      </Select>
      {canManage && <>
        <Button type="button" variant="outline" size="icon" disabled={disabled || saving} aria-label="Přidat typ projektu a prefix" onClick={() => { setError(''); setDraft({ name: '', prefix: '' }); }}><Plus className="h-4 w-4" /></Button>
        {selected && <Button type="button" variant="outline" size="icon" disabled={disabled || saving} aria-label="Upravit prefix typu projektu" onClick={() => { setError(''); setDraft({ id: selected.id, name: selected.name, prefix: selected.code_prefix || DEFAULT_PROJECT_PREFIX }); }}><Pencil className="h-4 w-4" /></Button>}
      </>}
    </div>
    {draft && <div className="space-y-3 rounded-lg border border-blue-100 bg-blue-50/60 p-3">
      <p className="text-sm font-medium">{draft.id ? 'Upravit prefix' : 'Nový typ projektu a prefix'}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1"><Label htmlFor={`${id}-name`}>Název typu</Label><Input id={`${id}-name`} value={draft.name} disabled={Boolean(draft.id) || saving} maxLength={100} onChange={e => setDraft(current => ({ ...current, name: e.target.value, prefix: current.prefix === suggestProjectPrefix(current.name) || !current.prefix ? suggestProjectPrefix(e.target.value) : current.prefix }))} placeholder="Např. FVE" /></div>
        <div className="space-y-1"><Label htmlFor={`${id}-prefix`}>Prefix</Label><Input id={`${id}-prefix`} value={draft.prefix} disabled={saving} maxLength={20} onChange={e => setDraft(current => ({ ...current, prefix: normalizeProjectPrefix(e.target.value) }))} placeholder="FVE" /></div>
      </div>
      <p className="text-xs text-slate-600">Projekt: {draft.prefix || DEFAULT_PROJECT_PREFIX}-{String(new Date().getFullYear()).slice(-2)}-001 · OP: OP-{draft.prefix || DEFAULT_PROJECT_PREFIX}-{String(new Date().getFullYear()).slice(-2)}-001. Stejný prefix sdílí řadu. Existující čísla zůstanou zachovaná.</p>
      <div className="flex gap-2"><Button type="button" size="sm" onClick={save} disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Uložit typ a prefix</Button><Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => { setDraft(null); setError(''); }}>Zrušit</Button></div>
    </div>}
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
  </div>;
}
