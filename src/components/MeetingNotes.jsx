import MeetingPrintDialog from '@/components/MeetingPrintDialog';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { supabase } from '@/lib/customSupabaseClient';
import { ensurePlanningPlan } from '@/lib/planningService';
import { fetchReportRows } from '@/lib/reportData';
import { MEETING_POINT_TYPES, validateMeetingNote, meetingDraftSignature, carryMeetingTasks } from '@/lib/meetingNotes';

const taskStatus = { not_started: 'Nezahájeno', planned: 'Naplánováno', ready: 'Připraveno', in_progress: 'V řešení', blocked: 'Blokováno', done: 'Hotovo', completed: 'Hotovo', cancelled: 'Zrušeno' };
const displayDate = value => value ? new Date(`${value.slice(0,10)}T12:00:00`).toLocaleDateString('cs-CZ') : 'nestanoven';
const control = 'mt-1 w-full rounded-md border bg-white p-2 text-sm';
export default function MeetingNotes({ entityType, entityId, entityTitle, canEdit, onOpenPlan }) {
  const [state,setState]=useState({ loading:true,rows:[],items:[],planId:null,error:'' });
  const [draft,setDraft]=useState(null);
  const [error,setError]=useState('');
  const [saving,setSaving]=useState(false);
  const [history,setHistory]=useState(null);
  const [printNote,setPrintNote]=useState(null);
  const [taskDraft,setTaskDraft]=useState(null);
  const [members,setMembers]=useState([]);
  const [actionError,setActionError]=useState('');
  const [baseline,setBaseline]=useState('');
  const [taskBaseline,setTaskBaseline]=useState('');
  const [discard,setDiscard]=useState(null);
  const [followUpCount,setFollowUpCount]=useState(null);
  const [membersLoading,setMembersLoading]=useState(false);
  const taskRequest=useRef(0);
  const dirty=Boolean(draft&&meetingDraftSignature(draft)!==baseline);
  const taskDirty=Boolean(taskDraft&&JSON.stringify([taskDraft.name,taskDraft.due,taskDraft.memberId])!==taskBaseline);
  const dismissTask=()=>{taskRequest.current++;setTaskDraft(null);};
  const closeTask=()=>{if(lock.current)return;if(taskDirty)setDiscard('task');else dismissTask();};
  const showHistory=async row=>{setActionError('');setHistory({row,loading:true,versions:[]}); const {data,error:failure}=await supabase.from('meeting_note_versions').select('version,snapshot,created_at').eq('note_id',row.id).order('version',{ascending:false}).limit(50);setHistory(h=>h?.row.id===row.id?{...h,loading:false,versions:data||[],error:failure?.message}:h);};
  const prepareTask=async(row,index)=>{
    const id=++taskRequest.current;
    const next={row,index,name:row.points[index].text.slice(0,200),due:new Date().toLocaleDateString('sv-SE'),memberId:''};
    setActionError('');setMembers([]);setMembersLoading(true);setTaskBaseline(JSON.stringify([next.name,next.due,next.memberId]));setTaskDraft(next);
    try{const {data,error:failure}=await supabase.rpc('list_planning_members_safe',{p_plan_id:row.plan_id});if(id!==taskRequest.current)return;if(failure)throw failure;setMembers(data||[]);}catch(e){if(id===taskRequest.current)setActionError(e.message||'Osoby se nepodařilo načíst.');}finally{if(id===taskRequest.current)setMembersLoading(false);}
  };
  const createTask=async event=>{event.preventDefault();if(lock.current)return;lock.current=true;setSaving(true);setActionError('');try{const {error:failure}=await supabase.rpc('create_meeting_point_task',{p_note_id:taskDraft.row.id,p_version:taskDraft.row.version,p_point_index:taskDraft.index,p_name:taskDraft.name,p_due:taskDraft.due,p_member_id:taskDraft.memberId});if(failure)throw failure;setTaskDraft(null);await load();}catch(e){setActionError(e.message);}finally{lock.current=false;setSaving(false);}};
  const followUp=row=>{const points=carryMeetingTasks(row.points,state.items);setError('');setBaseline('');setFollowUpCount(points.length);setDraft({id:crypto.randomUUID(),version:0,title:row.title,meeting_date:new Date().toLocaleDateString('sv-SE'),participants:row.participants,points});};
  useEffect(()=>{if(!dirty&&!taskDirty&&!saving)return;const prevent=event=>{event.preventDefault();event.returnValue='';};window.addEventListener('beforeunload',prevent);return()=>window.removeEventListener('beforeunload',prevent);},[dirty,taskDirty,saving]);
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
  useEffect(()=>{setDraft(null);setTaskDraft(null);setHistory(null);setDiscard(null);void load();return()=>{request.current++;taskRequest.current++;};},[load]);
  const open=row=>{const next=row?structuredClone(row):{id:crypto.randomUUID(),version:0,title:'Kontrolní den',meeting_date:new Date().toLocaleDateString('sv-SE'),participants:'',points:[]};setError('');setFollowUpCount(null);setBaseline(meetingDraftSignature(next));setDraft(next);};
  const close=()=>{if(lock.current)return;if(dirty)setDiscard('note');else setDraft(null);};
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
      {state.rows.map(row=><article key={row.id} className="rounded-xl border bg-white p-5"><div className="flex flex-wrap justify-between gap-3"><div><h3 className="font-semibold">{row.title}</h3><p className="text-sm text-slate-500">{displayDate(row.meeting_date)} · pracovní verze {row.version}</p></div><div className="flex flex-wrap gap-2"><Button variant="ghost" onClick={()=>setPrintNote(structuredClone(row))}>Tisk / PDF</Button><Button variant="ghost" onClick={()=>showHistory(row)}>Historie</Button>{canEdit&&<><Button variant="outline" onClick={()=>followUp(row)}>Navazující KD</Button><Button variant="outline" onClick={()=>open(row)}>Upravit zápis</Button></>}</div></div><p className="mt-3 whitespace-pre-wrap text-sm"><strong>Účastníci: </strong>{row.participants||'Neuvedeni'}</p><ol className="mt-4 space-y-3">{row.points.map((point,index)=>{const task=state.items.find(item=>item.id===point.planning_item_id);return <li key={index} className="rounded-lg bg-slate-50 p-3"><p className="text-xs font-semibold text-slate-500">{index+1}. {MEETING_POINT_TYPES[point.kind]}</p><p className="mt-1 whitespace-pre-wrap break-words text-sm">{point.text}</p>{canEdit&&!point.planning_item_id&&<Button variant="link" onClick={()=>prepareTask(row,index)}>Vytvořit úkol z bodu</Button>}{point.planning_item_id&&<div className="mt-2 text-sm">{task?<><strong>{task.name}</strong><span> · {taskStatus[task.status] || task.status} · termín {displayDate(task.end_date)}</span><Button variant="link" onClick={onOpenPlan}>Otevřít plán</Button></>:<span>Navázaný úkol již není dostupný.</span>}</div>}</li>;})}</ol></article>)}
    </>}
    <Dialog open={Boolean(history)} onOpenChange={value=>{if(!value)setHistory(null);}}><DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl"><DialogHeader><DialogTitle>Historie zápisu</DialogTitle><DialogDescription>Posledních 50 uložených verzí, pouze ke čtení.</DialogDescription></DialogHeader>{history?.loading?<p role="status">Načítám historii…</p>:history?.error?<p role="alert">{history.error}</p>:history?.versions.map(v=><details key={v.version} className="rounded-lg border p-3"><summary className="cursor-pointer font-medium">Verze {v.version} · {new Date(v.created_at).toLocaleString('cs-CZ')}</summary><Button variant="outline" size="sm" className="mt-3" onClick={()=>{setPrintNote(structuredClone(v.snapshot));setHistory(null);}}>Tisk této verze</Button><h3 className="mt-3 font-semibold">{v.snapshot.title}</h3><p className="text-sm">{displayDate(v.snapshot.meeting_date)} · {v.snapshot.participants||'Účastníci neuvedeni'}</p><ol className="mt-3 space-y-2">{v.snapshot.points.map((p,i)=><li key={i} className="whitespace-pre-wrap break-words text-sm">{i+1}. {MEETING_POINT_TYPES[p.kind]}: {p.text}</li>)}</ol></details>)}</DialogContent></Dialog>
    <Dialog open={Boolean(taskDraft)} onOpenChange={value=>{if(!value)closeTask();}}><DialogContent><DialogHeader><DialogTitle>Úkol z bodu zápisu</DialogTitle><DialogDescription>Úkol vznikne v plánu zakázky a propojí se s bodem zápisu v jednom kroku.</DialogDescription></DialogHeader>{taskDraft&&<form onSubmit={createTask} className="space-y-4"><fieldset disabled={saving} className="space-y-3"><label className="block text-sm">Název úkolu<Input required maxLength={200} value={taskDraft.name} onChange={e=>setTaskDraft({...taskDraft,name:e.target.value})}/></label><label className="block text-sm">Termín<Input required type="date" min={new Date().toLocaleDateString('sv-SE')} value={taskDraft.due} onChange={e=>setTaskDraft({...taskDraft,due:e.target.value})}/></label><label className="block text-sm">Odpovědná osoba<select required className={control} value={taskDraft.memberId} onChange={e=>setTaskDraft({...taskDraft,memberId:e.target.value})}><option value="">Vyberte osobu</option>{members.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label></fieldset>{actionError&&<p role="alert" className="text-sm text-red-700">{actionError}</p>}{membersLoading&&<p role="status" className="text-sm text-slate-500">Načítám dostupné osoby…</p>}{!membersLoading&&!members.length&&!actionError&&<p role="status" className="text-sm text-slate-500">Pro tento plán nejsou dostupné žádné osoby.</p>}<Button disabled={saving||membersLoading||!members.length}>{saving?'Vytvářím…':'Vytvořit a propojit úkol'}</Button></form>}</DialogContent></Dialog>
    <Dialog open={Boolean(draft)} onOpenChange={value=>{if(!value)close();}}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl"><DialogHeader><DialogTitle>{draft?.version?'Upravit zápis':'Nový zápis'}</DialogTitle><DialogDescription>Rozhodnutí a informace pište do bodů. Úkoly propojte s plánem, aby se jejich stav evidoval jen jednou.</DialogDescription></DialogHeader>{draft&&<form onSubmit={save} className="space-y-4">{followUpCount!==null&&<p role="status" className="rounded-lg bg-blue-50 p-3 text-sm">Převzaté otevřené úkoly: {followUpCount}. Odkazují na původní úkoly v plánu. Datum a účastníky můžete upravit.</p>}<fieldset disabled={saving} className="space-y-4"><div className="grid gap-4 sm:grid-cols-2"><label className="text-sm">Název<Input required maxLength={200} value={draft.title} onChange={e=>setDraft({...draft,title:e.target.value})}/></label><label className="text-sm">Datum jednání<Input required type="date" value={draft.meeting_date} onChange={e=>setDraft({...draft,meeting_date:e.target.value})}/></label></div><label className="block text-sm">Účastníci<Textarea maxLength={5000} value={draft.participants} onChange={e=>setDraft({...draft,participants:e.target.value})}/></label>{draft.points.map((point,index)=><div key={index} className="space-y-2 rounded-lg border p-3"><div className="flex items-center justify-between"><strong className="text-sm">Bod {index+1}</strong><Button type="button" variant="ghost" onClick={()=>setDraft({...draft,points:draft.points.filter((_,i)=>i!==index)})}>Odebrat bod</Button></div><label className="block text-sm">Typ bodu<select className={control} value={point.kind} onChange={e=>changePoint(index,{kind:e.target.value,planning_item_id:null})}>{Object.entries(MEETING_POINT_TYPES).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label className="block text-sm">Text bodu<Textarea required maxLength={5000} value={point.text} onChange={e=>changePoint(index,{text:e.target.value})}/></label>{point.kind==='task'&&<label className="block text-sm">Úkol v plánu<select required className={control} value={point.planning_item_id||''} onChange={e=>changePoint(index,{planning_item_id:e.target.value})}><option value="">Vyberte existující úkol</option>{state.items.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select>{!state.items.length&&<span className="text-xs text-slate-500">Zakázka zatím nemá úkoly. Nejprve založte úkol v sekci Plán.</span>}</label>}</div>)}<Button type="button" variant="outline" disabled={draft.points.length>=100} onClick={()=>setDraft({...draft,points:[...draft.points,{kind:'information',text:'',planning_item_id:null}]})}>Přidat bod</Button></fieldset>{error&&<p role="alert" className="whitespace-pre-wrap text-sm text-red-700">{error}</p>}<div className="flex gap-2"><Button type="submit" disabled={saving}>{saving?'Ukládám…':'Uložit pracovní zápis'}</Button><Button type="button" variant="outline" disabled={saving} onClick={close}>Zavřít formulář</Button></div></form>}</DialogContent></Dialog>
    <AlertDialog open={Boolean(discard)} onOpenChange={open=>{if(!open)setDiscard(null);}}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Zahodit rozepsané změny?</AlertDialogTitle><AlertDialogDescription>{discard==='task'?'Úkol ještě nebyl vytvořen. Zadané údaje budou ztraceny.':'Změny zápisu ještě nejsou uložené. Můžete pokračovat v úpravách nebo je zahodit.'}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Pokračovat v úpravách</AlertDialogCancel><AlertDialogAction onClick={()=>{if(discard==='task')dismissTask();else setDraft(null);setDiscard(null);}}>Zahodit změny</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    {printNote&&<MeetingPrintDialog note={printNote} entityTitle={entityTitle} entityType={entityType} onClose={()=>setPrintNote(null)}/>}
  </section>;
}
