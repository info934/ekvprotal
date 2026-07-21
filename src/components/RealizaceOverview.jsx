import React, { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Calendar, CircleDollarSign, MapPin, UserCheck, Users } from 'lucide-react';
import RealizaceTeam from './RealizaceTeam';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
import { getFinancialVisibility } from '@/lib/getFinancialVisibility';
import FinancialValueGuard from './FinancialValueGuard';
import { formatCurrency } from '@/lib/utils';
import { RecordAttentionList, RecordOverviewGrid, RecordOverviewItem, RecordOverviewPanel } from '@/components/ui/record-overview';

const formatDate = (value) => value ? new Date(`${value}T12:00:00`).toLocaleDateString('cs-CZ') : 'Bez termínu';

const RealizaceOverview = ({ realization, financialSnapshot }) => {
  const { userRole, memberId } = useAuth();
  const { canViewAmounts } = getFinancialVisibility(userRole);
  const [myReward, setMyReward] = useState(null);
  const [shareLoading, setShareLoading] = useState(false);

  useEffect(() => {
    if (canViewAmounts || !memberId || !realization?.id) {
      setMyReward(null);
      return;
    }

    let active = true;
    const fetchShare = async () => {
      setShareLoading(true);
      const { data, error } = await supabase.rpc('get_my_realization_reward', {
        p_realization_id: realization.id,
      });
      if (active) {
        setMyReward(error ? null : data || null);
        setShareLoading(false);
      }
    };
    fetchShare();
    return () => { active = false; };
  }, [canViewAmounts, memberId, realization?.id]);

  if (!realization) return null;

  const teamBudget = Number(financialSnapshot?.teamBudget || 0);
  const myRewardAmount = Number(myReward?.net_reward || 0);
  const sponsoredDeduction = Number(myReward?.sponsored_labor_deduction || 0);
  const missingEndDate = !realization.planned_end_date;
  const missingLead = !realization.lead_person?.id && !realization.lead_person_id;

  return (
    <div className="space-y-4">
      {!canViewAmounts && (
        <Card className="border-blue-100 bg-blue-50/50 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <CircleDollarSign className="h-4 w-4 text-blue-600" /> Moje odměna
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-semibold text-blue-700">
              {shareLoading ? 'Načítám…' : <FinancialValueGuard value={formatCurrency(myRewardAmount)} />}
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {myReward?.has_reward
                ? `${myReward.share_type === 'percent' ? `Podíl ${myReward.share_value} %` : 'Fixní odměna'}${sponsoredDeduction ? `, po odpočtu práce ${formatCurrency(sponsoredDeduction)}` : ''}`
                : 'Odměna zatím nebyla stanovena.'}
            </p>
          </CardContent>
        </Card>
      )}

      <RecordOverviewPanel
        title="Stav realizace"
        description="Provozní souhrn zakázky. Detailní náklady, odměny a fakturace jsou pouze v záložce Finance."
        badge={<Badge variant="outline" className="w-fit border-slate-200 bg-slate-50 text-slate-700">{realization.status || 'Bez stavu'}</Badge>}
        aside={(
          <RecordAttentionList items={[
            { label: 'Plánované dokončení', value: missingEndDate ? 'Není zadáno' : formatDate(realization.planned_end_date), tone: missingEndDate ? 'warning' : 'neutral' },
            { label: 'Vedoucí realizace', value: realization.lead_person?.name || 'Není přiřazen', tone: missingLead ? 'warning' : 'neutral' },
            { label: 'Stav zakázky', value: realization.status || 'Bez stavu', tone: realization.status === 'Pozastaveno' ? 'negative' : 'neutral' },
          ]} />
        )}
      >
        <RecordOverviewGrid>
          <RecordOverviewItem icon={UserCheck} label="Vedoucí" value={realization.lead_person?.name || 'Nepřiřazen'} detail={realization.lead_person?.email} tone={missingLead ? 'warning' : 'neutral'} />
          <RecordOverviewItem icon={Users} label="Investor" value={realization.investor?.name || 'Neuveden'} detail={realization.type || 'Typ realizace neuveden'} />
          <RecordOverviewItem icon={Calendar} label="Termín" value={formatDate(realization.planned_end_date)} detail={`Zahájení: ${formatDate(realization.start_date)}`} tone={missingEndDate ? 'warning' : 'neutral'} />
          <RecordOverviewItem icon={MapPin} label="Místo" value={realization.location_address || 'Adresa neuvedena'} detail={realization.location_gps || undefined} />
        </RecordOverviewGrid>
      </RecordOverviewPanel>

      <RealizaceTeam realizaceId={realization.id} teamBudget={teamBudget} />
    </div>
  );
};

export default RealizaceOverview;
