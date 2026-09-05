import React, { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, ChevronRight, Circle, Clock, CheckSquare, FolderPlus, Wallet, RefreshCw, CheckCircle2, AlertCircle, User } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import PageHeader from '@/components/ui/page-header';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import NewRecordMenu from '@/components/layout/NewRecordMenu';
import { taskDateLabel } from '@/domain/workOverview';

const defaultLoad = async args => (await import('@/lib/workOverviewService')).loadWorkOverview(args);
const EMPTY = { tasks: [], jobs: [], approvals: [], openCount: null, overdueCount: null, approvalCount: null, error: '' };
const formatCount = value => value === null || value === undefined ? '—' : value;
const date = value => value ? new Intl.DateTimeFormat('cs-CZ').format(new Date(`${String(value).slice(0, 10)}T12:00:00`)) : 'Bez termínu';
const statusTone = value => /hotovo|completed|done/i.test(value) ? 'positive' : /řešení|active|progress/i.test(value) ? 'info' : 'neutral';

export function WorkPanel({ title, action, children, className = '' }) {
  return <section className={`work-panel ${className}`}><div className="work-panel-heading"><h2>{title}</h2>{action}</div>{children}</section>;
}
export function WorkEmpty({ children }) {
  return <div className="work-empty"><CheckCircle2 size={24} strokeWidth={1.5} /><p>{children}</p></div>;
}
export function MyWorkView({ data, loading, onRefresh, hasPermission, memberId, tab, onTabChange }) {
  const actions = [
    ['attendance', 'Zapsat docházku', '/attendance', Clock],
    ['tasks', 'Moje úkoly', '/tasks?scope=mine', CheckSquare],
    ['projects', 'Nová zakázka', '/projects/new', FolderPlus, 'can_edit'],
    ['employee', 'Moje karta', memberId ? `/members/${memberId}` : '/members', User],
  ].filter(([module,,,, level]) => module === 'employee' || hasPermission(module, level || 'can_read'));
  return <div className="app-page work-home" aria-busy={loading}>
    <PageHeader title="Moje práce" description="Vše důležité pro váš pracovní den." actions={<NewRecordMenu />} />
    {data.error && <div role="alert" className="portal-inline-alert"><AlertCircle size={20} /><div className="flex-1">{data.error}</div><Button variant="outline" size="sm" onClick={onRefresh}><RefreshCw size={16} />Zkusit znovu</Button></div>}
    {data.reminders?.map(item => <Link key={item.path} to={item.path} className="portal-inline-alert"><Clock size={20}/><span>{item.label}</span><ChevronRight size={16}/></Link>)}
    <Tabs value={tab} onValueChange={onTabChange}>
      <TabsList className="work-tabs"><TabsTrigger value="overview">Přehled</TabsTrigger><TabsTrigger value="approvals">Ke schválení</TabsTrigger></TabsList>
      <div className="work-metrics" aria-label="Souhrn práce">
        {[['Otevřené úkoly', data.openCount], ['Po termínu', data.overdueCount], ['Ke schválení', data.approvalCount]].map(([label, value]) => <div key={label}><span>{label}</span><strong>{loading ? '—' : formatCount(value)}</strong></div>)}
      </div>
      <TabsContent value="overview" className="work-content">
        <div className="work-main-column">
          <WorkPanel title="Moje nejbližší úkoly" action={hasPermission('tasks', 'can_read') && <Link to="/tasks?scope=mine" className="work-text-link">Všechny úkoly<ChevronRight size={16} /></Link>}>
            {loading ? <div className="work-skeleton" aria-label="Načítám úkoly" /> : data.tasks.length ? <div className="work-task-list">{data.tasks.map(task => <Link className="work-task-row" key={task.id} to={task.path || (task.project_id && hasPermission('projects', 'can_read') ? `/projects/${task.project_id}#tasks` : '/tasks')}>
              <Circle size={18} strokeWidth={1.5} className="work-task-icon" aria-hidden="true" />
              <div className="work-task-name"><strong>{task.name}</strong><span>{[task.project?.code, task.project?.name].filter(Boolean).join(' · ') || 'Úkol'}</span></div>
              <span className={`work-due ${taskDateLabel(task.end_date) === 'Po termínu' ? 'is-overdue' : ''}`}>{taskDateLabel(task.end_date)}</span>
              <span className={`portal-status ${statusTone(task.status)}`}>{task.status || 'Nové'}</span><ChevronRight size={17} className="work-row-chevron" />
            </Link>)}</div> : <WorkEmpty>Žádné otevřené úkoly k vyřízení.</WorkEmpty>}
          </WorkPanel>
          <WorkPanel title="Rozpracované zakázky">
            {loading ? <div className="work-skeleton" /> : data.jobs.length ? <div className="work-job-list"><div className="work-job-head"><span>Zakázka</span><span>Oblast</span><span>Termín</span></div>{data.jobs.map(job => <Link key={job.path} to={job.path} className="work-job-row"><div><strong>{job.code && <span className="mr-2 font-normal text-slate-500">{job.code}</span>}{job.name}</strong></div><span className={`portal-status ${job.kind === 'Realizace' ? 'positive' : 'info'}`}>{job.kind}</span><span className="work-job-date">{date(job.date)}</span><ChevronRight size={16} /></Link>)}</div> : <WorkEmpty>V dostupných zakázkách není žádná rozpracovaná práce.</WorkEmpty>}
          </WorkPanel>
        </div>
        <aside className="work-side-column" aria-label="Rychlé akce a schvalování">
          <WorkPanel title="Rychlé akce">{actions.length ? actions.map(([module, label, path, Icon]) => <Link key={module} to={path} className="work-action-row"><Icon size={24} strokeWidth={1.6} /><span>{label}</span><ChevronRight size={17} /></Link>) : <WorkEmpty>Vaše dostupné moduly najdete v navigaci.</WorkEmpty>}</WorkPanel>
          <WorkPanel title="K vyřízení"><ApprovalRows items={data.approvals} loading={loading} /></WorkPanel>
        </aside>
      </TabsContent>
      <TabsContent value="approvals"><WorkPanel title="Schvalovací fronta"><p className="px-6 py-4 text-sm text-slate-500">Otevřete příslušnou agendu, zkontrolujte podklady a rozhodněte o žádosti.</p><ApprovalRows items={data.approvals} loading={loading} /></WorkPanel></TabsContent>
    </Tabs>
  </div>;
}
function ApprovalRows({ items, loading }) {
  if (loading) return <div className="work-skeleton" />;
  if (!items.length) return <WorkEmpty>Pro vaši roli není dostupná schvalovací agenda.</WorkEmpty>;
  return items.map(item => {
    const Icon = item.icon === 'attendance' ? Clock : item.icon === 'employee' ? User : Wallet;
    return <Link key={item.path} className="work-action-row" to={item.path}><Icon size={24} strokeWidth={1.6} /><span>{item.label}</span><span className="work-count">{formatCount(item.count)}</span><ArrowRight size={16} /></Link>;
  });
}
export default function MyWork({ loadWork = defaultLoad }) {
  const { hasPermission, memberId, isAdmin, userRole } = useAuth();
  const [data, setData] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [params, setParams] = useSearchParams();
  const requestId = useRef(0);
  useEffect(() => {
    const id = ++requestId.current;
    const controller = new AbortController();
    setLoading(true); setData(EMPTY);
    const timeout = setTimeout(() => controller.abort(), 20000);
    loadWork({ hasPermission, memberId, isAdmin, userRole, signal: controller.signal })
      .then(result => { if (id === requestId.current) setData(result); })
      .catch(() => { if (id === requestId.current) setData({ ...EMPTY, error: 'Pracovní přehled se nepodařilo načíst. Zkontrolujte připojení a zkuste to znovu.' }); })
      .finally(() => { clearTimeout(timeout); if (id === requestId.current) setLoading(false); });
    return () => { requestId.current++; clearTimeout(timeout); controller.abort(); };
  }, [hasPermission, memberId, isAdmin, userRole, revision, loadWork]);
  return <MyWorkView memberId={memberId} data={data} loading={loading} hasPermission={hasPermission} onRefresh={() => setRevision(value => value + 1)} tab={params.get('tab') === 'approvals' ? 'approvals' : 'overview'} onTabChange={value => setParams(value === 'overview' ? {} : { tab: value }, { replace: true })} />;
}
