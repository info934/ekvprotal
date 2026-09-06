import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, ArrowUpRight, Loader2, AlertCircle, Plus } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useAuth } from '@/contexts/AuthContext';
import { ALL_PORTAL_NAVIGATION, canNavigate } from '@/lib/portalNavigation';

const defaultSearch = async (...args) => (await import('@/lib/portalSearch')).searchPortal(...args);
export default function GlobalSearch({ open, onOpenChange, searchRecords = defaultSearch }) {
  const [query, setQuery] = useState('');
  const [state, setState] = useState({ results: [], loading: false, error: '' });
  const { hasPermission } = useAuth();
  const navigate = useNavigate();
  useEffect(() => { if (!open) setQuery(''); }, [open]);
  useEffect(() => {
    if (!open || query.trim().length < 2) { setState({ results: [], loading: false, error: '' }); return undefined; }
    const controller = new AbortController();
    setState({ results: [], loading: true, error: '' });
    const timer = setTimeout(async () => {
      try {
        const result = await searchRecords(query.trim(), hasPermission, controller.signal);
        if (!controller.signal.aborted) setState({ ...result, loading: false });
      } catch {
        if (!controller.signal.aborted) setState({ results: [], loading: false, error: 'Hledání se nepodařilo. Zkuste upravit dotaz nebo jej zadat znovu.' });
      }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, open, hasPermission, searchRecords]);
  const go = path => { onOpenChange(false); navigate(path); };
  const modules = ALL_PORTAL_NAVIGATION.filter(item => canNavigate(item, hasPermission));
  const recent = (() => { try { return JSON.parse(localStorage.getItem('ekv-recent-records') || '[]').slice(0, 5); } catch { return []; } })();
  const quickActions = [
    ['Nová projekce', '/projects/new', 'projects'],
    ['Nová realizace', '/realizace/new', 'realizace'],
    ['Nový obchodní případ', '/crm/new', 'crm'],
    ['Nový servisní případ', '/service?new=case', 'service'],
  ].filter(([, , module]) => hasPermission(module, 'can_edit'));
  const groupedResults = state.results.reduce((groups, item) => {
    const key = item.kind || 'Ostatní';
    groups[key] = [...(groups[key] || []), item];
    return groups;
  }, {});
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="portal-search-dialog p-0 sm:max-w-2xl">
      <DialogTitle className="sr-only">Hledat v portálu</DialogTitle>
      <DialogDescription className="sr-only">Hledejte zakázky, úkoly, klienty, zaměstnance a dokumenty podle názvu nebo čísla. Zobrazují se pouze záznamy, ke kterým máte přístup.</DialogDescription>
      <div className="flex items-center gap-3 border-b px-5 py-5 pr-12"><Search className="h-5 w-5 text-slate-400" /><input autoFocus aria-label="Hledat zakázku, úkol, klienta, zaměstnance nebo dokument" value={query} onChange={event => setQuery(event.target.value)} placeholder="Název, jméno, číslo zakázky nebo IČO…" className="min-w-0 flex-1 bg-transparent text-base outline-none" /></div>
      <div className="max-h-[60vh] overflow-y-auto p-2" aria-live="polite" aria-busy={state.loading}>
        {query.trim().length < 2 ? <>
          {quickActions.length > 0 && <><p className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Rychlé akce</p><div className="grid gap-1 sm:grid-cols-2">{quickActions.map(([label, path]) => <button type="button" key={path} className="portal-search-result" onClick={() => go(path)}><Plus size={18} /><span>{label}</span></button>)}</div></>}
          {recent.length > 0 && <><p className="mt-2 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Poslední záznamy</p>{recent.map(item => <button type="button" key={item.path} className="portal-search-result" onClick={() => go(item.path)}><div className="min-w-0 flex-1 text-left"><strong className="block truncate text-sm font-medium">{item.label}</strong><span className="block truncate text-xs text-slate-500">{item.path}</span></div><ArrowUpRight size={16} className="text-slate-400" /></button>)}</>}
          <p className="mt-2 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Moduly</p>{modules.map(item => <button type="button" key={item.path} className="portal-search-result" onClick={() => go(item.path)}><item.icon size={18} /><span>{item.label}</span><ArrowUpRight size={16} className="ml-auto text-slate-400" /></button>)}</> : <>
          {state.loading && <p className="flex items-center gap-2 p-6 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Hledám záznamy…</p>}
          {state.error && <p role="alert" className="flex items-start gap-2 p-4 text-sm text-amber-800"><AlertCircle size={18} className="shrink-0" />{state.error}</p>}
          {!state.loading && !state.error && !state.results.length && <div className="px-4 py-10 text-center"><p className="font-semibold">Žádné odpovídající záznamy</p><p className="mt-1 text-sm text-slate-500">Zkuste část názvu nebo jiné číslo.</p></div>}
          {Object.entries(groupedResults).map(([kind, items]) => <section key={kind}><h3 className="px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">{kind}</h3>{items.map(item => <button type="button" key={`${item.kind}-${item.id}`} className="portal-search-result" onClick={() => go(item.path)}><div className="min-w-0 flex-1 text-left"><strong className="block truncate text-sm font-medium">{item.title}</strong><span className="text-xs text-slate-500">{item.code || kind}</span></div><ArrowUpRight size={16} className="text-slate-400" /></button>)}</section>)}
        </>}
      </div>
      <p className="border-t px-5 py-3 text-xs text-slate-500">Tab pro výběr · Enter pro otevření · Esc pro zavření</p>
    </DialogContent>
  </Dialog>;
}
