import React,{useEffect,useState,useMemo} from 'react';
import {Link,useSearchParams,useLocation} from 'react-router-dom';
import {useAuth} from '@/contexts/AuthContext';
import {supabase} from '@/lib/customSupabaseClient';
import {loadUnifiedTasks,filterWorkTasks,taskQueueFilters,taskExactDate} from '@/lib/unifiedTasks';
import {taskDateLabel,isClosedTask} from '@/domain/workOverview';
import PageHeader from '@/components/ui/page-header';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
const scopes={open:'Otevřené',mine:'Moje',overdue:'Po termínu',blocked:'Blokované',all:'Všechny'};
export default function UnifiedTaskQueue(){
 const {hasPermission,memberId}=useAuth();const [params,setParams]=useSearchParams();
 const [state,setState]=useState({rows:[],loading:true,error:''});const [revision,refresh]=useState(0);
 const location=useLocation();
 const {scope,kind,search}=taskQueueFilters(params);
 const [visibleCount,setVisibleCount]=useState(30);
 useEffect(()=>setVisibleCount(30),[scope,kind,search]);
 const reset=()=>setParams({}, {replace:true});
 const change=(key,value)=>setParams(p=>{const next=new URLSearchParams(p);value?next.set(key,value):next.delete(key);return next;},{replace:true});
 useEffect(()=>{const controller=new AbortController();let active=true;const timeout=setTimeout(()=>controller.abort(),20000);setState(s=>({...s,loading:true,error:''}));
 loadUnifiedTasks(supabase,{hasPermission,signal:controller.signal}).then(rows=>{if(active)setState({rows,loading:false,error:''});}).catch(e=>{if(active)setState({rows:[],loading:false,error:e.message||'Úkoly se nepodařilo načíst.'});}).finally(()=>clearTimeout(timeout));return()=>{active=false;clearTimeout(timeout);controller.abort();};},[hasPermission,revision]);
 const rows=useMemo(()=>filterWorkTasks(state.rows,{scope,kind,search,memberId}),[state.rows,scope,kind,search,memberId]);
 return <div className="app-page space-y-4" aria-busy={state.loading}><PageHeader title="Úkoly" description="Společná fronta projekce a realizace. Změny provádíte přímo v plánu zakázky." actions={<><Button variant="outline" disabled={state.loading} onClick={()=>refresh(x=>x+1)}>Obnovit</Button><Button variant="outline" asChild><Link to="/tasks?view=project">Správa úkolů projekce</Link></Button></>}/>
 <div className="flex flex-wrap gap-2" aria-label="Výběr úkolů">{Object.entries(scopes).map(([key,label])=><Button key={key} variant={scope===key?'default':'outline'} aria-pressed={scope===key} onClick={()=>change('scope',key)}>{label}<span className="ml-2">{state.loading||state.error?'—':filterWorkTasks(state.rows,{scope:key,memberId,kind,search}).length}</span></Button>)}</div>
 <div className="flex flex-wrap gap-3"><Input className="min-w-0 flex-1" aria-label="Hledat úkol nebo zakázku" placeholder="Hledat úkol nebo zakázku…" value={search} onChange={e=>change('q',e.target.value)}/><select aria-label="Oblast úkolu" className="rounded-md border bg-white p-2 text-sm" value={kind} onChange={e=>change('kind',e.target.value)}><option value="all">Všechny oblasti</option><option value="project">Projekce</option><option value="realization">Realizace</option></select></div>
 <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-500"><span role="status">{state.loading?'Načítám úkoly…':state.error?'Počet úkolů není dostupný':`Zobrazeno ${Math.min(visibleCount,rows.length)} z ${rows.length} úkolů`}</span>{(scope!=='open'||kind!=='all'||search)&&<Button variant="ghost" size="sm" onClick={reset}>Zrušit filtry</Button>}</div>
 {scope==='mine'&&!memberId&&<p role="status">Váš účet zatím nemá přiřazenou kartu zaměstnance.</p>}
 {state.error?<p role="alert" className="rounded-lg border border-red-200 p-4">{state.error} Zkuste přehled obnovit.</p>:state.loading?<p role="status">Načítám úkoly…</p>:<section className="overflow-hidden rounded-xl border bg-white" aria-label="Seznam úkolů">{rows.length?rows.slice(0,visibleCount).map(t=><Link key={t.id} to={t.path} state={{returnTo:location.pathname+location.search}} className="flex flex-wrap items-center justify-between gap-3 border-b p-4 last:border-0 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2"><div className="min-w-0 flex-1"><strong className="block break-words">{t.name}</strong><span className="text-sm text-slate-500">{t.kind==='project'?'Projekce':'Realizace'} · {t.project?.name||t.project?.code||'Zakázka'}</span></div><span className={t.status==='Blokováno'?'text-sm text-red-700':'text-sm text-slate-600'}>{t.status}</span><span className="text-right text-sm">{taskExactDate(t.end_date) ? <><span className="block">{taskExactDate(t.end_date)}</span>{!isClosedTask(t) && ['Dnes','Zítra','Po termínu'].includes(taskDateLabel(t.end_date)) && <span className="block text-xs text-slate-500">{taskDateLabel(t.end_date)}</span>}</> : 'Bez termínu'}</span></Link>):<p className="p-8 text-center text-slate-500">Tomuto výběru neodpovídá žádný úkol.</p>}</section>}
 {!state.loading&&!state.error&&rows.length>visibleCount&&<div className="flex justify-center"><Button variant="outline" onClick={()=>setVisibleCount(count=>count+30)}>Zobrazit dalších {Math.min(30,rows.length-visibleCount)} úkolů</Button></div>}
 </div>;
}
