import React, { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { format, startOfYear, endOfYear, addYears, subYears } from 'date-fns';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

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
        setYearlyData(data);
      }
      setLoading(false);
    };

    fetchYearlyAttendance();
  }, [memberId, year, toast, attendanceEnabled]);

  const totalYearlyHours = useMemo(() => {
    return yearlyData.reduce((sum, record) => sum + Number(record.hours), 0);
  }, [yearlyData]);

  if (!attendanceEnabled) {
      return null;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="glass-effect rounded-xl p-6"
    >
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-bold flex items-center gap-2"><Calendar className="w-5 h-5"/> Roční souhrn hodin</h3>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => setYear(subYears(year, 1))}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="font-bold text-lg">{format(year, 'yyyy')}</span>
          <Button variant="outline" size="icon" onClick={() => setYear(addYears(year, 1))}>
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>
      {loading ? (
        <div className="flex items-center justify-center h-24">
          <p className="text-muted-foreground">Načítání dat...</p>
        </div>
      ) : (
        <div className="text-center">
            <p className="text-muted-foreground">Celkem za rok {format(year, 'yyyy')}</p>
            <p className="text-4xl font-extrabold gradient-text">{totalYearlyHours.toFixed(2)}</p>
            <p className="text-muted-foreground">hodin</p>
        </div>
      )}
    </motion.div>
  );
};

export default YearlyAttendanceSummary;