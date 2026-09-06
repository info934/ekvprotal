import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';

const WEEKDAYS = ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'];

const dateKey = (value) => {
  if (!value) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Prague',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};

const timeLabel = (value) => value
  ? new Intl.DateTimeFormat('cs-CZ', { timeZone: 'Europe/Prague', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
  : '';

const statusClass = (status) => {
  if (status === 'completed') return 'border-emerald-200 bg-emerald-50 text-emerald-900';
  if (status === 'cancelled') return 'border-slate-200 bg-slate-100 text-slate-500 line-through';
  return 'border-blue-200 bg-blue-50 text-blue-950';
};

const CRMActivityMonthCalendar = ({ month, activities }) => {
  const { cells, activitiesByDay } = useMemo(() => {
    const [year, monthNumber] = month.split('-').map(Number);
    const daysInMonth = new Date(year, monthNumber, 0).getDate();
    const mondayOffset = (new Date(year, monthNumber - 1, 1).getDay() + 6) % 7;
    const nextCells = [
      ...Array.from({ length: mondayOffset }, () => null),
      ...Array.from({ length: daysInMonth }, (_, index) => index + 1),
    ];
    while (nextCells.length % 7) nextCells.push(null);

    const grouped = new Map();
    activities.forEach((activity) => {
      const key = dateKey(activity.starts_at || activity.due_at);
      if (!key) return;
      grouped.set(key, [...(grouped.get(key) || []), activity]);
    });
    grouped.forEach((items) => items.sort((left, right) => new Date(left.starts_at || left.due_at) - new Date(right.starts_at || right.due_at)));
    return { cells: nextCells, activitiesByDay: grouped };
  }, [activities, month]);

  const today = dateKey(new Date().toISOString());

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[820px]">
        <div className="grid grid-cols-7 border-b bg-slate-50">
          {WEEKDAYS.map((day) => <div key={day} className="px-2 py-2 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">{day}</div>)}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((day, index) => {
            const key = day ? `${month}-${String(day).padStart(2, '0')}` : `empty-${index}`;
            const dayActivities = day ? activitiesByDay.get(key) || [] : [];
            return (
              <div key={key} className={`min-h-[126px] border-b border-r p-2 ${day ? 'bg-white' : 'bg-slate-50/70'}`}>
                {day && <>
                  <div className="mb-2 flex items-center justify-between">
                    <span className={`flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold ${key === today ? 'bg-primary text-primary-foreground' : 'text-slate-700'}`}>{day}</span>
                    {dayActivities.length > 0 && <Badge variant="outline" className="h-5 bg-white px-1.5 text-[10px]">{dayActivities.length}</Badge>}
                  </div>
                  <div className="space-y-1.5">
                    {dayActivities.slice(0, 3).map((activity) => {
                      const content = <><span className="font-semibold">{timeLabel(activity.starts_at || activity.due_at)}</span>{' '}{activity.title}</>;
                      const className = `block truncate rounded-md border px-2 py-1 text-[11px] leading-4 ${statusClass(activity.status)}`;
                      return activity.opportunity
                        ? <Link key={activity.id} className={className} title={activity.title} to={`/crm/opportunities/${activity.opportunity.id}`}>{content}</Link>
                        : <div key={activity.id} className={className} title={activity.title}>{content}</div>;
                    })}
                    {dayActivities.length > 3 && <p className="px-1 text-[11px] font-medium text-muted-foreground">+ {dayActivities.length - 3} další</p>}
                  </div>
                </>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default CRMActivityMonthCalendar;
