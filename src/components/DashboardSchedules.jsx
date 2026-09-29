import React, { useCallback, useState } from 'react';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
import { fetchReportRows } from '@/lib/reportData';
import { useOverviewQuery } from '@/hooks/useOverviewQuery';
import { overviewScope } from '@/lib/overviewCache';
import { isCancelledDashboardRecord } from '@/lib/crmDashboardMetrics';
import { Button } from '@/components/ui/button';

const ProjectGanttChart = React.lazy(() => import('@/components/ProjectGanttChart'));
const RealizationGanttChart = React.lazy(() => import('@/components/RealizationGanttChart'));

export default function DashboardSchedules({ refreshToken = 0 }) {
  const { user, memberId, userRole, permissions, isPrivateMode, hasPermission } = useAuth();
  const [zoom, setZoom] = useState('month');
  const scope = overviewScope({ userId: user?.id, memberId, userRole, permissions, isPrivateMode });
  const load = useCallback(async signal => {
    const [projects, realizations] = await Promise.all([
      hasPermission('projects','can_read') ? fetchReportRows(() => supabase.from('projects')
        .select('id,name,code,status,start_date,created_at,completion_date').order('id'), signal) : [],
      hasPermission('realizace','can_read') ? fetchReportRows(() => supabase.from('realizations')
        .select('id,name,code,status,start_date,created_at,planned_end_date,actual_end_date').order('id'), signal) : [],
    ]);
    return { projects: projects.filter(row => !isCancelledDashboardRecord(row)), realizations: realizations.filter(row => !isCancelledDashboardRecord(row)) };
  }, [hasPermission]);
  const query = useOverviewQuery({ name: `dashboard-schedules:${refreshToken}`, scope, load });
  if (query.error) return <div role="alert" className="portal-inline-alert">{query.error}<Button variant="outline" onClick={query.refresh}>Obnovit</Button></div>;
  if (!query.data) return <div className="h-48 animate-pulse rounded-md bg-slate-100" aria-label="Načítám harmonogramy" />;
  return <div className="space-y-5">
    <section><h2 className="mb-3 text-base font-semibold">Harmonogram projektů</h2><ProjectGanttChart projects={query.data.projects} zoom={zoom} onZoomChange={setZoom} /></section>
    <section><h2 className="mb-3 text-base font-semibold">Harmonogram realizací</h2><RealizationGanttChart realizations={query.data.realizations} zoom={zoom} onZoomChange={setZoom} /></section>
  </div>;
}
