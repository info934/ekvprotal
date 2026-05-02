import React from 'react';
import { motion } from 'framer-motion';
import { format, differenceInDays, startOfDay, parseISO } from 'date-fns';
import { cs } from 'date-fns/locale';

const TaskGanttChart = ({ tasks }) => {
  const validTasks = tasks.filter(t => t.start_date && t.end_date);

  if (!validTasks || validTasks.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground bg-slate-50 rounded-lg">
        <p>Žádné úkoly s termínem k zobrazení.</p>
        <p className="text-sm">Nastavte úkolům datum zahájení a dokončení pro zobrazení v časové ose.</p>
      </div>
    );
  }

  const today = startOfDay(new Date());
  
  const overallStartDate = startOfDay(new Date(Math.min(...validTasks.map(t => parseISO(t.start_date).getTime()))));
  const overallEndDate = startOfDay(new Date(Math.max(...validTasks.map(t => parseISO(t.end_date).getTime()))));

  const totalDays = Math.max(differenceInDays(overallEndDate, overallStartDate) + 1, 30);
  
  const sortedTasks = [...validTasks].sort((a,b) => parseISO(a.start_date) - parseISO(b.start_date));

  const getBarColor = (task) => {
    if (task.status === 'Hotovo') {
      return 'bg-green-500';
    }
    const endDate = parseISO(task.end_date);
    if (endDate < today) {
      return 'bg-red-500';
    }
    if (task.status === 'V řešení') {
      return 'bg-yellow-500';
    }
    return 'bg-blue-500';
  };

  const todayOffset = differenceInDays(today, overallStartDate);
  const isTodayVisible = todayOffset >= 0 && todayOffset <= totalDays;

  const monthMarkers = [];
  let currentDate = new Date(overallStartDate);
  while (currentDate <= overallEndDate) {
    const offset = differenceInDays(currentDate, overallStartDate);
    monthMarkers.push({
      label: format(currentDate, 'LLLL', { locale: cs }),
      offset: (offset / totalDays) * 100,
    });
    currentDate.setMonth(currentDate.getMonth() + 1);
    currentDate.setDate(1);
  }

  return (
    <div className="space-y-3 relative p-4 bg-slate-50 rounded-lg overflow-x-auto">
      <div className="w-full h-full relative" style={{ minWidth: '800px' }}>
          <div className="absolute top-8 bottom-0 left-[250px] right-0">
              {isTodayVisible && (
                  <div 
                  className="absolute top-0 bottom-0 border-r-2 border-dashed border-red-500 z-10"
                  style={{ left: `calc(${(todayOffset / totalDays) * 100}%)` }}
                  >
                  <div className="absolute -top-6 -translate-x-1/2 bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded-full z-20">DNES</div>
                  </div>
              )}
          </div>

          <div className="flex items-center sticky top-0 bg-slate-50 z-20 pb-2">
              <div className="w-[250px] pr-4 font-semibold text-muted-foreground">Úkol</div>
              <div className="flex-1 relative h-8">
                  {monthMarkers.map((marker, index) => (
                      <div key={index} className="absolute top-0 text-xs font-bold text-slate-400" style={{ left: `${marker.offset}%` }}>
                          {marker.label}
                      </div>
                  ))}
              </div>
          </div>

          <div className="space-y-2">
              {sortedTasks.map((task, index) => {
                  const startDate = startOfDay(parseISO(task.start_date));
                  const endDate = startOfDay(parseISO(task.end_date));
                  const startOffset = Math.max(0, differenceInDays(startDate, overallStartDate));
                  const duration = Math.max(1, differenceInDays(endDate, startDate) + 1);
                  
                  const barColor = getBarColor(task);

                  return (
                    <motion.div
                      key={task.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.05 }}
                      className="group flex items-center h-12"
                    >
                      <div className="w-[250px] pr-4 truncate">
                          <p className="font-medium truncate text-slate-800 text-sm">{task.name}</p>
                          <p className="text-xs text-muted-foreground">{task.member?.name || 'Nepřiřazeno'}</p>
                      </div>
                      <div className="flex-1 relative h-full">
                          <div className="relative h-full w-full bg-slate-200 rounded-sm">
                            <motion.div
                              initial={{ width: 0 }}
                              animate={{ width: `${(duration / totalDays) * 100}%` }}
                              transition={{ duration: 0.5, ease: 'easeInOut' }}
                              style={{
                                left: `${(startOffset / totalDays) * 100}%`,
                              }}
                              className={`absolute top-1/2 -translate-y-1/2 h-8 rounded-sm ${barColor} transition-opacity group-hover:opacity-80 cursor-pointer`}
                              title={`${task.name}: ${format(startDate, 'd.M.yy')} - ${format(endDate, 'd.M.yy')}`}
                            >
                                <div className="absolute inset-0 flex items-center justify-between px-2 text-white text-[10px] font-bold opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                                  <span>{format(startDate, 'd.M.')}</span>
                                  <span>{format(endDate, 'd.M.')}</span>
                                </div>
                            </motion.div>
                          </div>
                      </div>
                  </motion.div>
                  );
              })}
          </div>
      </div>
    </div>
  );
};

export default TaskGanttChart;