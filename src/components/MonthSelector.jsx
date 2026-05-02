import React, { useMemo } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { format, subMonths, startOfMonth } from 'date-fns';
import { cs } from 'date-fns/locale';

const MonthSelector = ({ value, onChange }) => {
  const months = useMemo(() => {
    const result = [];
    const currentDate = new Date();
    for (let i = 0; i < 12; i++) {
      const date = subMonths(currentDate, i);
      const start = startOfMonth(date).toISOString();
      const label = format(date, 'LLLL yyyy', { locale: cs });
      // Capitalize first letter of month
      const capitalizedLabel = label.charAt(0).toUpperCase() + label.slice(1);
      result.push({ value: start, label: capitalizedLabel });
    }
    return result;
  }, []);

  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium text-slate-700">Vyberte měsíc</label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-[250px] bg-white">
          <SelectValue placeholder="Vyberte měsíc" />
        </SelectTrigger>
        <SelectContent>
          {months.map((month) => (
            <SelectItem key={month.value} value={month.value}>
              {month.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};

export default MonthSelector;