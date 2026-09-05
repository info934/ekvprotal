import React,{useEffect,useState} from 'react';
import {Link,useSearchParams} from 'react-router-dom';
import {useAuth} from '@/contexts/AuthContext';
import {supabase} from '@/lib/customSupabaseClient';
import {loadUnifiedTasks,filterWorkTasks} from '@/lib/unifiedTasks';
import {taskDateLabel} from '@/domain/workOverview';
import PageHeader from '@/components/ui/page-header';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
const scopes={open:'Otevřené',mine:'Moje',overdue:'Po termínu',blocked:'Blokované',all:'Všechny'};
export default function UnifiedTaskQueue(){
 const {hasPermission,memberId}=useAuth();const [params,setParams]=useSearchParams();
 const [state,setState]=useState({rows:[],loading:true,error:''});const [revision,refresh]=useState(0);
 const scope=scopes[params.get('scope')]?params.get('scope'):'open';
 const kind=['project','realization'].includes(params.get('kind'))?params.get('kind'):'all';
 const search=params.get('q')||'';
 const change=(key,value)=>setParams(p=>{const next=new URLSearchParams(p);value?next.set(key,value):next.delete(key);return next;},{replace:true});
 useEffect(()=>{const controller=new AbortController();let active=true;setState(s=>({...s,loading:true,error:''}));
 loadUnifiedTasks(supabase,{hasPermission,signal:controller.signal}).then(rows=>{if(active)setState({rows,loading:false,error:''});}).catch(e=>{if(active)setState({rows:[],loading:false,error:e.message||'Úkoly se nepodařilo načíst.'});});return()=>{active=false;controller.abort();};},[hasPermission,revision]);
 const rows=filterWorkTasks(state.rows,{scope,kind,search,memberId});
 return <div className="app-page space-y-4"><PageHeader title="Úkoly" description="Společná fronta projekce a realizace. Změny provádíte přímo v plánu zakázky." actions={<><Button variant="outline" onClick={()=>refresh(x=>x+1)}>Obnovit</Button><Button variant="outline" asChild><Link to="/tasks?view=project">Správa úkolů projekce</Link></Button></>}/>
 <div className="flex flex-wrap gap-2" aria-label="Výběr úkolů">{Object.entries(scopes).map(([key,label])=><Button key={key} variant={scope===key?'default':'outline'} aria-pressed={scope===key} onClick={()=>change('scope',key)}>{label}<span className="ml-2">{state.loading||state.error?'—':filterWorkTasks(state.rows,{scope:key,memberId}).length}</span></Button>)}</div>
 <div className="flex flex-wrap gap-3"><Input className="min-w-0 flex-1" aria-label="Hledat úkol nebo zakázku" placeholder="Hledat úkol nebo zakázku…" value={search} onChange={e=>change('q',e.target.value)}/><select aria-label="Oblast úkolu" className="rounded-md border bg-white p-2 text-sm" value={kind} onChange={e=>change('kind',e.target.value)}><option value="all">Všechny oblasti</option><option value="project">Projekce</option><option value="realization">Realizace</option></select></div>
 {scope==='mine'&&!memberId&&<p role="status">Váš účet zatím nemá přiřazenou kartu zaměstnance.</p>}
 {state.error?<p role="alert" className="rounded-lg border border-red-200 p-4">{state.error} Zkuste přehled obnovit.</p>:state.loading?<p role="status">Načítám úkoly…</p>:<section className="overflow-hidden rounded-xl border bg-white" aria-label="Seznam úkolů">{rows.length?rows.map(t=><Link key={t.id} to={t.path} className="flex flex-wrap items-center justify-between gap-3 border-b p-4 last:border-0 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2"><div className="min-w-0 flex-1"><strong className="block break-words">{t.name}</strong><span className="text-sm text-slate-500">{t.kind==='project'?'Projekce':'Realizace'} · {t.project?.name||t.project?.code||'Zakázka'}</span></div><span className={t.status==='Blokováno'?'text-sm text-red-700':'text-sm text-slate-600'}>{t.status}</span><span className="text-sm">{taskDateLabel(t.end_date)}</span></Link>):<p className="p-8 text-center text-slate-500">Tomuto výběru neodpovídá žádný úkol.</p>}</section>}
 </div>;
}
