import React from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export default function MonthSelector({ value, onChange }) {
  const changeInput = event => { if (/^\d{4}-(0[1-9]|1[0-2])$/.test(event.currentTarget.value) && Number(event.currentTarget.value.slice(0,4)) > 0) onChange(`${event.currentTarget.value}-01`); };
  const step = offset => {
    const [year, month] = value.split('-').map(Number);
    const index = year * 12 + month - 1 + offset;
    const nextYear = Math.floor(index / 12);
    if (nextYear < 1 || nextYear > 9999) return;
    onChange(`${String(nextYear).padStart(4, '0')}-${String(index % 12 + 1).padStart(2, '0')}-01`);
  };
  return <div className="flex min-w-0 flex-col gap-2"><label htmlFor="hourly-payout-month" className="text-sm font-medium text-slate-700">Měsíc odměny</label><div className="flex min-w-0 gap-2"><Button variant="outline" size="icon" aria-label="Předchozí měsíc odměny" onClick={() => step(-1)}><ChevronLeft className="h-4 w-4" /></Button><Input id="hourly-payout-month" type="month" className="w-full min-w-0 sm:w-[190px]" value={value?.slice(0,7) || ''} onInput={changeInput} onChange={changeInput} /><Button variant="outline" size="icon" aria-label="Následující měsíc odměny" onClick={() => step(1)}><ChevronRight className="h-4 w-4" /></Button></div></div>;
}
