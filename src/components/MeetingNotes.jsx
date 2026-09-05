import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { supabase } from '@/lib/customSupabaseClient';
import { ensurePlanningPlan } from '@/lib/planningService';
import { fetchReportRows } from '@/lib/reportData';
import { MEETING_POINT_TYPES, validateMeetingNote } from '@/lib/meetingNotes';

const taskStatus = { not_started: 'Nezahájeno', planned: 'Naplánováno', in_progress: 'V řešení', blocked: 'Blokováno', done: 'Hotovo', completed: 'Hotovo', cancelled: 'Zrušeno' };
const displayDate = value => value ? new Date(`${value.slice(0,10)}T12:00:00`).toLocaleDateString('cs-CZ') : 'nestanoven';
const control = 'mt-1 w-full rounded-md border bg-white p-2 text-sm';
export default function MeetingNotes({ entityType, entityId, canEdit, onOpenPlan }) {
  const [state,setState]=useState({ loading:true,rows:[],items:[],planId:null,error:'' });
  const [draft,setDraft]=useState(null);
  const [error,setError]=useState('');
  const [saving,setSaving]=useState(false);
  useEffect(()=>{ if(!draft)return; const prevent=event=>{event.preventDefault();event.returnValue='';}; window.addEventListener('beforeunload',prevent); return()=>window.removeEventListener('beforeunload',prevent); },[draft]);
  const lock=useRef(false);
  const request=useRef(0);
  const load=useCallback(async()=>{
    const id=++request.current;
    setState(s=>({...s,loading:true,error:''}));
    try {
      const plan=await ensurePlanningPlan(entityType,entityId,{createIfMissing:false});
      const [rows,items]=plan ? await Promise.all([
        fetchReportRows(()=>supabase.from('meeting_notes').select('*').eq('plan_id',plan.plan_id).order('meeting_date',{ascending:false}).order('id')),
        fetchReportRows(()=>supabase.from('planning_items').select('id,name,status,start_date,end_date').eq('plan_id',plan.plan_id).eq('item_type','task').order('name').order('id')),
      ]) : [[],[]];
      if(id===request.current) setState({loading:false,rows,items,planId:plan?.plan_id||null,error:''});
    } catch(e) { if(id===request.current) setState(s=>({...s,loading:false,error:e.code==='42P01' ? 'Zápisy KD čekají na aktivaci databázové migrace.' : e.message||'Zápisy se nepodařilo načíst.'})); }
  },[entityType,entityId]);
  useEffect(()=>{setDraft(null);void load();return()=>{request.current++;};},[load]);
  const open=row=>{setError('');setDraft(row ? structuredClone(row) : {id:crypto.randomUUID(),version:0,title:'Kontrolní den',meeting_date:new Date().toLocaleDateString('sv-SE'),participants:'',points:[]});};
  const close=()=>{if(!lock.current && window.confirm('Zavřít formulář? Neuložené změny budou ztraceny.')) setDraft(null);};
  const save=async event=>{
    event.preventDefault(); if(lock.current||!canEdit)return;
    const problem=validateMeetingNote(draft);if(problem){setError(problem);return;}
    lock.current=true;setSaving(true);setError('');
    try {
      const planId=state.planId||(await ensurePlanningPlan(entityType,entityId)).plan_id;
      const {error:failure}=await supabase.rpc('save_meeting_note',{p_id:draft.id,p_plan_id:planId,p_version:draft.version,p_title:draft.title,p_date:draft.meeting_date,p_participants:draft.participants,p_points:draft.points});
      if(failure)throw failure;
      setDraft(null);await load();
    }catch(e){setError(e.message||'Uložení selhalo. Rozepsaný zápis zůstal zachovaný.');}
    finally{lock.current=false;setSaving(false);}
  };
  const changePoint=(index,patch)=>setDraft(d=>({...d,points:d.points.map((p,i)=>i===index?{...p,...patch}:p)}));
  return <section className="space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-semibold">Zápisy a kontrolní dny</h2><p className="mt-1 text-sm text-slate-600">Interní pracovní zápisy, rozhodnutí a vazby na úkoly této zakázky.</p></div>{canEdit&&<Button disabled={state.loading||Boolean(state.error)} onClick={()=>open()}>Nový zápis</Button>}</div>
    <p className="rounded-lg border bg-slate-50 p-3 text-sm text-slate-600">Pracovní verze · zápisy se zatím neposílají externím účastníkům. Uložením nevzniká nový úkol ani změna rozpočtu.</p>
    {state.loading?<p role="status">Načítám zápisy…</p>:state.error?<div role="alert" className="rounded-lg border border-red-200 p-4"><p>{state.error}</p><Button variant="outline" className="mt-3" onClick={load}>Zkusit znovu</Button></div>:<>
      {!state.rows.length&&<div className="rounded-xl border border-dashed p-8 text-center"><h3 className="font-semibold">Zatím žádný zápis</h3><p className="mt-2 text-sm text-slate-600">Zaznamenejte první jednání a propojte jeho body s úkoly v plánu.</p></div>}
      {state.rows.map(row=><article key={row.id} className="rounded-xl border bg-white p-5"><div className="flex flex-wrap justify-between gap-3"><div><h3 className="font-semibold">{row.title}</h3><p className="text-sm text-slate-500">{displayDate(row.meeting_date)} · pracovní verze {row.version}</p></div>{canEdit&&<Button variant="outline" onClick={()=>open(row)}>Upravit zápis</Button>}</div><p className="mt-3 whitespace-pre-wrap text-sm"><strong>Účastníci: </strong>{row.participants||'Neuvedeni'}</p><ol className="mt-4 space-y-3">{row.points.map((point,index)=>{const task=state.items.find(item=>item.id===point.planning_item_id);return <li key={index} className="rounded-lg bg-slate-50 p-3"><p className="text-xs font-semibold text-slate-500">{index+1}. {MEETING_POINT_TYPES[point.kind]}</p><p className="mt-1 whitespace-pre-wrap break-words text-sm">{point.text}</p>{point.planning_item_id&&<div className="mt-2 text-sm">{task?<><strong>{task.name}</strong><span> · {taskStatus[task.status] || task.status} · termín {displayDate(task.end_date)}</span><Button variant="link" onClick={onOpenPlan}>Otevřít plán</Button></>:<span>Navázaný úkol již není dostupný.</span>}</div>}</li>;})}</ol></article>)}
    </>}
    <Dialog open={Boolean(draft)} onOpenChange={value=>{if(!value)close();}}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl"><DialogHeader><DialogTitle>{draft?.version?'Upravit zápis':'Nový zápis'}</DialogTitle><DialogDescription>Rozhodnutí a informace pište do bodů. Úkoly propojte s plánem, aby se jejich stav evidoval jen jednou.</DialogDescription></DialogHeader>{draft&&<form onSubmit={save} className="space-y-4"><fieldset disabled={saving} className="space-y-4"><div className="grid gap-4 sm:grid-cols-2"><label className="text-sm">Název<Input required maxLength={200} value={draft.title} onChange={e=>setDraft({...draft,title:e.target.value})}/></label><label className="text-sm">Datum jednání<Input required type="date" value={draft.meeting_date} onChange={e=>setDraft({...draft,meeting_date:e.target.value})}/></label></div><label className="block text-sm">Účastníci<Textarea maxLength={5000} value={draft.participants} onChange={e=>setDraft({...draft,participants:e.target.value})}/></label>{draft.points.map((point,index)=><div key={index} className="space-y-2 rounded-lg border p-3"><div className="flex items-center justify-between"><strong className="text-sm">Bod {index+1}</strong><Button type="button" variant="ghost" onClick={()=>setDraft({...draft,points:draft.points.filter((_,i)=>i!==index)})}>Odebrat bod</Button></div><label className="block text-sm">Typ bodu<select className={control} value={point.kind} onChange={e=>changePoint(index,{kind:e.target.value,planning_item_id:null})}>{Object.entries(MEETING_POINT_TYPES).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label className="block text-sm">Text bodu<Textarea required maxLength={5000} value={point.text} onChange={e=>changePoint(index,{text:e.target.value})}/></label>{point.kind==='task'&&<label className="block text-sm">Úkol v plánu<select required className={control} value={point.planning_item_id||''} onChange={e=>changePoint(index,{planning_item_id:e.target.value})}><option value="">Vyberte existující úkol</option>{state.items.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select>{!state.items.length&&<span className="text-xs text-slate-500">Zakázka zatím nemá úkoly. Nejprve založte úkol v sekci Plán.</span>}</label>}</div>)}<Button type="button" variant="outline" disabled={draft.points.length>=100} onClick={()=>setDraft({...draft,points:[...draft.points,{kind:'information',text:'',planning_item_id:null}]})}>Přidat bod</Button></fieldset>{error&&<p role="alert" className="whitespace-pre-wrap text-sm text-red-700">{error}</p>}<div className="flex gap-2"><Button type="submit" disabled={saving}>{saving?'Ukládám…':'Uložit pracovní zápis'}</Button><Button type="button" variant="outline" disabled={saving} onClick={close}>Zavřít</Button></div></form>}</DialogContent></Dialog>
  </section>;
}
