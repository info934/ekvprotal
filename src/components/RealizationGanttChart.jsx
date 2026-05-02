import React, { useRef, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { format, differenceInDays, startOfDay, addDays, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns';
import { Link } from 'react-router-dom';
import { cs } from 'date-fns/locale';

const RealizationGanttChart = ({ realizations, zoom, onZoomChange }) => {
  const containerRef = useRef(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const updateWidth = () => {
      if (containerRef.current) {
        setContainerWidth(containerRef.current.offsetWidth);
      }
    };

    window.addEventListener('resize', updateWidth);
    updateWidth();
    return () => window.removeEventListener('resize', updateWidth);
  }, []);

  // Filter valid realizations
  const validRealizations = realizations ? realizations.filter(r => (r.start_date || r.created_at) && (r.planned_end_date || r.actual_end_date)) : [];

  if (!validRealizations || validRealizations.length === 0) {
    return (
      <div className="text-center py-6 text-muted-foreground bg-slate-50/50 rounded-lg border border-dashed border-slate-200">
        <p className="text-sm">Žádná data realizací pro zobrazení v časové ose.</p>
        <p className="text-xs mt-1">Realizace musí mít nastavené datum zahájení a plánované dokončení.</p>
      </div>
    );
  }

  const today = startOfDay(new Date());
  
  // Calculate range based on data
  const minDate = new Date(Math.min(...validRealizations.map(r => new Date(r.start_date || r.created_at).getTime())));
  const maxDate = new Date(Math.max(...validRealizations.map(r => new Date(r.planned_end_date || r.actual_end_date).getTime())));

  // Tighter view ranges to save space
  let viewStartDate, viewEndDate;
  
  if (zoom === 'day') {
    viewStartDate = addDays(minDate, -1);
    viewEndDate = addDays(maxDate, 2);
  } else if (zoom === 'week') {
    viewStartDate = startOfWeek(addDays(minDate, -3), { weekStartsOn: 1 });
    viewEndDate = endOfWeek(addDays(maxDate, 3), { weekStartsOn: 1 });
  } else { // month
    viewStartDate = startOfMonth(addDays(minDate, -10));
    viewEndDate = endOfMonth(addDays(maxDate, 10));
  }

  const totalDays = Math.max(differenceInDays(viewEndDate, viewStartDate) + 1, 30);
  
  // Optimized sizing constants for standard monitors
  const SIDEBAR_WIDTH = 150; 
  const HEADER_HEIGHT = 32; 
  const ROW_HEIGHT = 32; 
  
  const minCellWidth = zoom === 'day' ? 28 : zoom === 'week' ? 6 : 2.5; 
  
  const timelineContentWidth = Math.max(containerWidth - SIDEBAR_WIDTH, totalDays * minCellWidth);

  const sortedRealizations = [...validRealizations].sort((a,b) => new Date(a.start_date || a.created_at) - new Date(b.start_date || b.created_at));

  const getBarColor = (realization) => {
    if (realization.status === 'Dokončeno' || realization.status === 'Předáno') {
      return 'bg-green-500';
    }
    const endDate = new Date(realization.planned_end_date || realization.actual_end_date);
    if (endDate < today) {
      return 'bg-red-500';
    }
    if (realization.status === 'V realizaci') {
        return 'bg-blue-600';
    }
    return 'bg-orange-500';
  };

  // Generate markers
  const markers = [];
  let currentDate = new Date(viewStartDate);
  
  while (currentDate <= viewEndDate) {
    const offsetDays = differenceInDays(currentDate, viewStartDate);
    const leftPercent = (offsetDays / totalDays) * 100;
    
    if (zoom === 'month') {
        if (currentDate.getDate() === 1) {
             markers.push({
                key: currentDate.toISOString(),
                label: format(currentDate, 'LLL', { locale: cs }), 
                left: leftPercent,
                type: 'major'
             });
        }
    } else if (zoom === 'week') {
        if (currentDate.getDay() === 1) { // Monday
             markers.push({
                key: currentDate.toISOString(),
                label: `${format(currentDate, 'd.M.')}`,
                left: leftPercent,
                type: 'major'
             });
        }
    } else if (zoom === 'day') {
         markers.push({
            key: currentDate.toISOString(),
            label: format(currentDate, 'd'),
            subLabel: format(currentDate, 'EE', { locale: cs }),
            left: leftPercent,
            type: 'major'
         });
    }
    
    currentDate = addDays(currentDate, 1);
  }

  const todayOffsetDays = differenceInDays(today, viewStartDate);
  const todayLeftPercent = (todayOffsetDays / totalDays) * 100;
  const isTodayVisible = todayOffsetDays >= 0 && todayOffsetDays <= totalDays;

  return (
    <div className="flex flex-col h-full bg-slate-50/50 rounded-lg border border-slate-200" ref={containerRef}>
      {/* Controls */}
      <div className="flex items-center justify-between px-3 py-2 border-b bg-white/50 rounded-t-lg">
        <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Harmonogram Realizací</h3>
        <div className="flex bg-slate-100 p-0.5 rounded-md scale-90 origin-right">
            {['month', 'week', 'day'].map((z) => (
                <button
                    key={z}
                    onClick={() => onZoomChange(z)}
                    className={`
                        px-2 py-0.5 text-[10px] font-medium rounded-sm transition-all
                        ${zoom === z 
                            ? 'bg-white text-primary shadow-sm' 
                            : 'text-muted-foreground hover:text-foreground hover:bg-white/50'}
                    `}
                >
                    {z === 'month' ? 'Měsíc' : z === 'week' ? 'Týden' : 'Den'}
                </button>
            ))}
        </div>
      </div>

      {/* Chart Content */}
      <div className="flex-1 overflow-hidden flex flex-col relative min-h-[300px]">
         <div className="flex-1 overflow-auto custom-scrollbar">
            <div className="flex min-w-full" style={{ width: timelineContentWidth + SIDEBAR_WIDTH }}>
                {/* Left Column - Fixed Width */}
                <div 
                    className="sticky left-0 z-20 flex-shrink-0 bg-slate-50 border-r border-slate-200 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]"
                    style={{ width: SIDEBAR_WIDTH }}
                >
                    <div 
                        className="border-b border-slate-200 bg-slate-100/50 flex items-center px-3"
                        style={{ height: HEADER_HEIGHT }}
                    >
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Realizace</span>
                    </div>
                    <div className="py-1 space-y-[2px] bg-slate-50/80 backdrop-blur-sm">
                        {sortedRealizations.map((realization) => (
                            <div 
                                key={realization.id} 
                                className="px-3 flex flex-col justify-center truncate group hover:bg-slate-100 transition-colors"
                                style={{ height: ROW_HEIGHT }}
                            >
                                <Link 
                                    to={`/realizace/${realization.id}`} 
                                    className="text-[11px] font-medium text-slate-700 truncate hover:text-primary transition-colors block leading-tight" 
                                    title={realization.name}
                                >
                                    {realization.name}
                                </Link>
                                <span className="text-[9px] text-muted-foreground truncate opacity-70 group-hover:opacity-100">
                                    {realization.status}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Timeline Area - Dynamic Width */}
                <div className="flex-grow relative bg-white">
                    {/* Header / Axis */}
                    <div 
                        className="border-b border-slate-200 bg-slate-50 sticky top-0 z-10 w-full overflow-hidden"
                        style={{ height: HEADER_HEIGHT }}
                    >
                         {markers.map((marker) => (
                            <div 
                                key={marker.key} 
                                className="absolute top-0 bottom-0 border-l border-slate-200 pl-1 flex flex-col justify-center"
                                style={{ left: `${marker.left}%` }}
                            >
                                <span className="text-[10px] font-bold text-slate-600 leading-none whitespace-nowrap">{marker.label}</span>
                                {marker.subLabel && <span className="text-[9px] text-slate-400 font-medium leading-none mt-0.5">{marker.subLabel}</span>}
                            </div>
                         ))}
                    </div>

                    {/* Grid Background */}
                    <div className="absolute inset-0 pointer-events-none" style={{ top: HEADER_HEIGHT }}>
                        {markers.map((marker) => (
                             <div 
                                key={`grid-${marker.key}`} 
                                className={`absolute top-0 bottom-0 border-l ${zoom === 'day' ? 'border-slate-100' : 'border-slate-50'}`}
                                style={{ left: `${marker.left}%` }}
                            />
                        ))}
                         {/* Today Line */}
                         {isTodayVisible && (
                            <div 
                                className="absolute top-0 bottom-0 border-l border-red-400 z-10"
                                style={{ left: `${todayLeftPercent}%` }}
                            >
                                <div className="absolute -top-1 -translate-x-1/2 w-1.5 h-1.5 bg-red-500 rounded-full" />
                            </div>
                         )}
                    </div>
                    
                    {/* Bars Container */}
                    <div className="py-1 space-y-[2px] relative w-full">
                        {sortedRealizations.map((realization, index) => {
                             const startDate = startOfDay(new Date(realization.start_date || realization.created_at));
                             const endDate = startOfDay(new Date(realization.planned_end_date || realization.actual_end_date));
                             
                             const startDiff = differenceInDays(startDate, viewStartDate);
                             const durationDays = differenceInDays(endDate, startDate) + 1;
                             
                             const leftPercent = (startDiff / totalDays) * 100;
                             const widthPercent = (durationDays / totalDays) * 100;
                             
                             const barColor = getBarColor(realization);

                             return (
                                <motion.div 
                                    key={`bar-${realization.id}`}
                                    className="relative w-full group"
                                    style={{ height: ROW_HEIGHT }}
                                    initial={{ opacity: 0, x: -10 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ delay: index * 0.01 }}
                                >
                                    {/* Row Hover Highlight */}
                                    <div className="absolute inset-0 group-hover:bg-slate-50/50 pointer-events-none transition-colors" />

                                    {/* The Bar */}
                                    <div 
                                        className="absolute top-1/2 -translate-y-1/2 h-4 rounded-[3px] shadow-sm transition-all hover:shadow hover:brightness-110 cursor-pointer overflow-hidden flex items-center px-1.5"
                                        style={{ 
                                            left: `${Math.max(0, leftPercent)}%`, 
                                            width: `${Math.max(0.2, Math.min(100 - leftPercent, widthPercent))}%`,
                                            minWidth: '2px'
                                        }}
                                    >
                                        <div className={`absolute inset-0 ${barColor} opacity-90`} />
                                        
                                        {/* Label inside bar */}
                                        <span className="relative z-10 text-[9px] font-bold text-white whitespace-nowrap overflow-hidden text-ellipsis opacity-0 group-hover:opacity-100 transition-opacity">
                                            {durationDays}d
                                        </span>
                                    </div>
                                    
                                    {/* Tooltip */}
                                    <div className="absolute top-full left-0 z-50 bg-slate-800 text-white text-[10px] px-2 py-0.5 rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap shadow-lg translate-y-0.5"
                                         style={{ left: `${Math.min(90, Math.max(0, leftPercent))}%` }}>
                                        {format(startDate, 'd.M.')} - {format(endDate, 'd.M.yyyy')}
                                    </div>
                                </motion.div>
                             );
                        })}
                    </div>
                </div>
            </div>
         </div>
      </div>
    </div>
  );
};

export default RealizationGanttChart;