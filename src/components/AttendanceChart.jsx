import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { format, getDaysInMonth, eachDayOfInterval, startOfMonth, endOfMonth } from 'date-fns';
import { cs } from 'date-fns/locale';

const AttendanceChart = ({ attendance, month }) => {
  const chartData = useMemo(() => {
    const daysInMonth = eachDayOfInterval({
      start: startOfMonth(month),
      end: endOfMonth(month),
    });

    return daysInMonth.map(day => {
      const dayKey = format(day, 'yyyy-MM-dd');
      const hoursForDay = attendance
        .filter(record => record.date === dayKey)
        .reduce((sum, record) => sum + Number(record.hours), 0);
      
      return {
        day: format(day, 'd'),
        dayName: format(day, 'eee', { locale: cs }),
        hours: hoursForDay,
      };
    });
  }, [attendance, month]);

  const maxHours = Math.max(...chartData.map(d => d.hours), 8); // Ensure a minimum height for 8 hours

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="glass-effect rounded-xl p-6"
    >
      <h3 className="text-lg font-bold mb-4">Grafický přehled hodin</h3>
      <div className="flex gap-1 items-end h-48 w-full overflow-x-auto pb-4">
        {chartData.map((data, index) => (
          <div key={index} className="flex-1 flex flex-col items-center justify-end min-w-[2rem] group relative">
            <motion.div
              className="w-full bg-gradient-to-t from-purple-500 to-indigo-500 rounded-t-md"
              initial={{ height: 0 }}
              animate={{ height: `${(data.hours / maxHours) * 100}%` }}
              transition={{ duration: 0.5, delay: index * 0.02 }}
            >
              <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 bg-slate-800 text-white text-xs rounded-md px-2 py-1 absolute -top-7 left-1/2 -translate-x-1/2">
                {data.hours.toFixed(2)} h
              </div>
            </motion.div>
            <span className="text-xs text-muted-foreground mt-2">{data.day}</span>
            <span className="text-xs text-muted-foreground font-bold capitalize">{data.dayName}</span>
          </div>
        ))}
      </div>
    </motion.div>
  );
};

export default AttendanceChart;