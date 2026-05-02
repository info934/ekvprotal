import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { format, endOfMonth, startOfMonth } from 'date-fns';
import { cs } from 'date-fns/locale';
import { Loader2 } from 'lucide-react';

const HoursTable = ({ selectedMonth, memberId, onDataFetched }) => {
  const [loading, setLoading] = useState(false);
  const [records, setRecords] = useState([]);
  const [totalHours, setTotalHours] = useState(0);

  useEffect(() => {
    const fetchAttendance = async () => {
      if (!selectedMonth || !memberId) return;

      setLoading(true);
      try {
        const startDate = startOfMonth(new Date(selectedMonth)).toISOString();
        const endDate = endOfMonth(new Date(selectedMonth)).toISOString();

        const { data, error } = await supabase
          .from('attendance')
          .select('*, projects(id, name)')
          .eq('member_id', memberId)
          .gte('date', startDate)
          .lte('date', endDate)
          .order('date', { ascending: false });

        if (error) throw error;

        setRecords(data || []);
        
        const total = (data || []).reduce((sum, record) => sum + Number(record.hours), 0);
        setTotalHours(total);

        // Group by project for breakdown
        const breakdown = (data || []).reduce((acc, curr) => {
            const projName = curr.projects?.name || 'Nezařazeno (Režie)';
            if (!acc[projName]) acc[projName] = 0;
            acc[projName] += Number(curr.hours);
            return acc;
        }, {});

        if (onDataFetched) {
          onDataFetched({ records: data || [], totalHours: total, breakdown });
        }
      } catch (error) {
        console.error('Error fetching attendance for HoursTable:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchAttendance();
  }, [selectedMonth, memberId]);

  if (loading) {
    return (
      <div className="flex justify-center items-center py-8 text-slate-500">
        <Loader2 className="w-6 h-6 animate-spin mr-2" />
        Načítání hodin...
      </div>
    );
  }

  if (records.length === 0) {
    return (
      <div className="text-center py-8 text-slate-500 bg-slate-50 rounded-lg border border-dashed">
        Pro vybraný měsíc nebyly nalezeny žádné hodiny.
      </div>
    );
  }

  return (
    <div className="rounded-md border border-slate-200 overflow-hidden">
      <Table>
        <TableHeader className="bg-slate-50">
          <TableRow>
            <TableHead>Datum</TableHead>
            <TableHead>Projekt</TableHead>
            <TableHead className="text-right">Hodiny</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {records.map((record) => (
            <TableRow key={record.id}>
              <TableCell>{format(new Date(record.date), 'dd. MM. yyyy', { locale: cs })}</TableCell>
              <TableCell className="font-medium text-slate-700">
                {record.projects?.name || 'Nezařazeno (Režie)'}
              </TableCell>
              <TableCell className="text-right">{Number(record.hours).toFixed(1)} h</TableCell>
            </TableRow>
          ))}
          <TableRow className="bg-slate-50 font-bold">
            <TableCell colSpan={2} className="text-right">Celkem hodin:</TableCell>
            <TableCell className="text-right text-primary">{totalHours.toFixed(1)} h</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
};

export default HoursTable;