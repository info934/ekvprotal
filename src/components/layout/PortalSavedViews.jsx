import React, { useCallback, useEffect, useState } from 'react';
import { Bookmark, Loader2, Plus, Trash2 } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { getPortalSection } from '@/lib/portalNavigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

const tableSettings = () => {
  const result = {};
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key?.startsWith('ekv-table-')) result[key] = localStorage.getItem(key);
  }
  return result;
};

export default function PortalSavedViews() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const section = getPortalSection(location.pathname);
  const module = section.path === '/' ? 'work' : section.path.split('/').filter(Boolean)[0];
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    const { data } = await supabase.from('portal_saved_views').select('*').eq('user_id', user.id).eq('module', module).order('updated_at', { ascending: false });
    setRows(data || []);
    setLoading(false);
  }, [module, user?.id]);
  useEffect(() => { if (open) load(); }, [load, open]);

  const save = async () => {
    const cleanName = name.trim() || `${section.label} – můj pohled`;
    await supabase.from('portal_saved_views').insert({
      user_id: user.id,
      module,
      name: cleanName,
      filters: Object.fromEntries(new URLSearchParams(location.search)),
      sorting: [{ hash: location.hash }],
      columns: tableSettings(),
      route: `${location.pathname}${location.search}${location.hash}`,
    });
    setName('');
    await load();
  };
  const apply = row => {
    Object.entries(row.columns || {}).forEach(([key, value]) => localStorage.setItem(key, value));
    setOpen(false);
    navigate(row.route || section.path);
    window.setTimeout(() => window.dispatchEvent(new Event('ekv-saved-view-applied')), 0);
  };
  const remove = async row => { await supabase.from('portal_saved_views').delete().eq('id', row.id).eq('user_id', user.id); await load(); };

  return <Popover open={open} onOpenChange={setOpen}><PopoverTrigger asChild><Button variant="ghost" size="icon" className="shrink-0" aria-label="Uložené pohledy"><Bookmark className="h-5 w-5" /></Button></PopoverTrigger><PopoverContent align="end" className="w-[min(360px,calc(100vw-24px))]">
    <h2 className="font-semibold">Uložené pohledy · {section.label}</h2>
    <div className="mt-3 flex gap-2"><Input value={name} onChange={e => setName(e.target.value)} placeholder="Název pohledu" /><Button size="icon" onClick={save} aria-label="Uložit aktuální pohled"><Plus className="h-4 w-4" /></Button></div>
    <p className="mt-2 text-xs text-muted-foreground">Uloží se aktuální filtry, řazení a sloupce k vašemu účtu.</p>
    <div className="mt-3 max-h-72 divide-y overflow-y-auto">{loading ? <p className="flex items-center gap-2 py-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Načítám…</p> : rows.length ? rows.map(row => <div key={row.id} className="flex items-center gap-2 py-2"><button type="button" onClick={() => apply(row)} className="min-w-0 flex-1 rounded-md p-2 text-left hover:bg-slate-50"><strong className="block truncate text-sm">{row.name}</strong><span className="text-xs text-muted-foreground">{new Date(row.updated_at).toLocaleDateString('cs-CZ')}</span></button><Button variant="ghost" size="icon" onClick={() => remove(row)} aria-label={`Smazat ${row.name}`}><Trash2 className="h-4 w-4" /></Button></div>) : <p className="py-5 text-center text-sm text-muted-foreground">Zatím nemáte uložený pohled.</p>}</div>
  </PopoverContent></Popover>;
}
