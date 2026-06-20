import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { format, startOfYear, endOfYear, addYears, subYears } from 'date-fns';
import { Calendar, ChevronLeft, ChevronRight, Timer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DataVizCard, DataVizEmptyState, DataVizMetricCard } from '@/components/ui/data-viz';

const YearlyAttendanceSummary = ({ memberId, attendanceEnabled }) => {
  const { toast } = useToast();
  const [year, setYear] = useState(new Date());
  const [yearlyData, setYearlyData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchYearlyAttendance = async () => {
      if (!memberId || !attendanceEnabled) {
        setLoading(false);
        return;
      }
      setLoading(true);

      const startDate = startOfYear(year);
      const endDate = endOfYear(year);

      const { data, error } = await supabase
        .from('attendance')
        .select('hours')
        .eq('member_id', memberId)
        .gte('date', format(startDate, 'yyyy-MM-dd'))
        .lte('date', format(endDate, 'yyyy-MM-dd'));

      if (error) {
        toast({ title: 'Chyba při načítání ročního přehledu', description: error.message, variant: 'destructive' });
        setYearlyData([]);
      } else {
        setYearlyData(data || []);
      }
      setLoading(false);
    };

    fetchYearlyAttendance();
  }, [memberId, year, toast, attendanceEnabled]);

  const totalYearlyHours = useMemo(() => yearlyData.reduce((sum, record) => sum + Number(record.hours), 0), [yearlyData]);

  if (!attendanceEnabled) return null;

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
      <DataVizCard
        title="Roční souhrn hodin"
        description="Rychlý pohled na odpracované hodiny v aktuálně vybraném roce."
        icon={Calendar}
        action={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={() => setYear(subYears(year, 1))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="min-w-16 text-center text-sm font-semibold text-slate-950">{format(year, 'yyyy')}</span>
            <Button variant="outline" size="icon" onClick={() => setYear(addYears(year, 1))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        }
      >
        {loading ? (
          <DataVizEmptyState label="Načítám roční souhrn..." />
        ) : (
          <DataVizMetricCard icon={Timer} label={`Celkem za rok ${format(year, 'yyyy')}`} value={`${totalYearlyHours.toFixed(2)} h`} tone="blue" />
        )}
      </DataVizCard>
    </motion.div>
  );
};

export default YearlyAttendanceSummary;