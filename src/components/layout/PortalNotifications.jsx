import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { Button } from '@/components/ui/button';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';

export default function PortalNotifications() {
  const { user, memberId, isPrivateMode } = useAuth();
  const [state, setState] = useState({ userId: null, rows: [], error: '' });
  const [reload, setReload] = useState(0);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      if (!user?.id) return;
      try {
        const { data, error } = await supabase.from('notifications').select('id,type,title,message,is_read,created_at')
          .eq('user_id', user.id).order('is_read').order('created_at', { ascending: false }).limit(50).abortSignal(controller.signal);
        if (!controller.signal.aborted) setState({ userId: user.id, rows: data || [], error: error ? 'Oznámení se nepodařilo načíst.' : '' });
      } catch { if (!controller.signal.aborted) setState({ userId: user.id, rows: [], error: 'Oznámení se nepodařilo načíst.' }); }
    };
    load();
    const timer = setInterval(load, 60000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [user?.id, reload]);
  const rows = state.userId === user?.id ? state.rows : [];
  const unread = rows.filter(row => !row.is_read).length;
  const markRead = async id => {
    const { error } = await supabase.from('notifications').update({ is_read: true }).eq('id', id).eq('user_id', user.id);
    if (error) setState(current => ({ ...current, error: 'Označení jako přečtené se nezdařilo.' }));
    else setReload(value => value + 1);
  };
  return <Popover open={open} onOpenChange={value => { setOpen(value); if (value) setReload(current => current + 1); }}>
    <PopoverTrigger asChild><Button variant="ghost" size="icon" aria-label={`Oznámení${unread ? `, nepřečtená: ${unread}${unread === 50 ? '+' : ''}` : ''}`} className="relative shrink-0"><Bell size={20} />{unread > 0 && <span className="absolute right-0 top-0 rounded-full bg-red-600 px-1 text-[10px] text-white">{unread === 50 ? '50+' : unread}</span>}</Button></PopoverTrigger>
    <PopoverContent align="end" className="w-[min(390px,calc(100vw-24px))] max-h-[70vh] overflow-y-auto"><h2 className="font-semibold">Oznámení</h2>
      {state.userId === user?.id && state.error && <p role="alert" className="mt-3 text-sm text-red-700">{state.error}</p>}
      {rows.length === 0 && !state.error && <p className="mt-3 text-sm text-muted-foreground">Žádná oznámení.</p>}
      <ul className="divide-y">{rows.map(row => <li key={row.id} className="py-3"><p className={`text-sm ${row.is_read ? '' : 'font-semibold'}`}>{row.title}</p><p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted-foreground">{isPrivateMode ? 'Obsah oznámení je v soukromém režimu skrytý.' : row.message}</p><p className="mt-1 text-xs text-muted-foreground">{new Date(row.created_at).toLocaleString('cs-CZ')}</p><div className="mt-2 flex flex-wrap items-center gap-3">{row.type === 'project_bonus' && memberId && <Link className="text-sm text-blue-700 underline" to={`/members/${memberId}?tab=finance`} onClick={() => setOpen(false)}>Moje finance</Link>}{!row.is_read && <Button size="sm" variant="outline" onClick={() => markRead(row.id)}>Označit jako přečtené</Button>}</div></li>)}</ul>
      {rows.length === 50 && <p className="text-xs text-muted-foreground">Zobrazeno 50 oznámení, přednostně nepřečtená.</p>}
    </PopoverContent>
  </Popover>;
}
