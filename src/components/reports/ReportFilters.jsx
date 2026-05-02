import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from 'date-fns';
import { Filter, Calendar as CalendarIcon, X } from 'lucide-react';

const ReportFilters = ({ 
  filters, 
  onChange, 
  options = {}, // { members: [], projects: [], statuses: [], types: [] }
  showDateRange = true,
  showMember = false,
  showProject = false,
  showStatus = false,
  showType = false,
  showCategory = false
}) => {
  
  const handleFilterChange = (key, value) => {
    onChange({ ...filters, [key]: value });
  };

  const clearFilters = () => {
    onChange({
      startDate: '',
      endDate: '',
      period: 'all',
      memberId: 'all',
      projectId: 'all',
      status: 'all',
      type: 'all',
      category: 'all'
    });
  };

  return (
    <Card className="mb-6">
      <CardContent className="p-4">
        <div className="flex flex-col space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium flex items-center gap-2">
              <Filter className="w-4 h-4" /> Filtry reportu
            </h3>
            <Button variant="ghost" size="sm" onClick={clearFilters} className="h-8">
              <X className="w-3 h-3 mr-1" /> Vymazat
            </Button>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {showDateRange && (
              <>
                <div className="space-y-1">
                  <Label className="text-xs">Období</Label>
                  <Select 
                    value={filters.period || 'all'} 
                    onValueChange={(val) => {
                      const today = new Date();
                      let start = '';
                      let end = format(today, 'yyyy-MM-dd');
                      
                      if (val === 'this_month') {
                        start = format(new Date(today.getFullYear(), today.getMonth(), 1), 'yyyy-MM-dd');
                        end = format(new Date(today.getFullYear(), today.getMonth() + 1, 0), 'yyyy-MM-dd');
                      } else if (val === 'last_month') {
                        start = format(new Date(today.getFullYear(), today.getMonth() - 1, 1), 'yyyy-MM-dd');
                        end = format(new Date(today.getFullYear(), today.getMonth(), 0), 'yyyy-MM-dd');
                      } else if (val === 'this_year') {
                        start = format(new Date(today.getFullYear(), 0, 1), 'yyyy-MM-dd');
                        end = format(new Date(today.getFullYear(), 11, 31), 'yyyy-MM-dd');
                      } else if (val === 'custom') {
                        start = filters.startDate;
                        end = filters.endDate;
                      }

                      onChange({ 
                        ...filters, 
                        period: val,
                        startDate: start,
                        endDate: end
                      });
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Vyberte období" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Vše</SelectItem>
                      <SelectItem value="this_month">Tento měsíc</SelectItem>
                      <SelectItem value="last_month">Minulý měsíc</SelectItem>
                      <SelectItem value="this_year">Tento rok</SelectItem>
                      <SelectItem value="custom">Vlastní rozsah</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                {filters.period === 'custom' && (
                  <div className="space-y-1 col-span-1 lg:col-span-2 grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">Od</Label>
                      <Input 
                        type="date" 
                        value={filters.startDate} 
                        onChange={(e) => handleFilterChange('startDate', e.target.value)} 
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Do</Label>
                      <Input 
                        type="date" 
                        value={filters.endDate} 
                        onChange={(e) => handleFilterChange('endDate', e.target.value)} 
                      />
                    </div>
                  </div>
                )}
              </>
            )}

            {showMember && (
              <div className="space-y-1">
                <Label className="text-xs">Člen týmu</Label>
                <Select value={filters.memberId || 'all'} onValueChange={(val) => handleFilterChange('memberId', val)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Všichni" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Všichni</SelectItem>
                    {options.members?.map(m => (
                      <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {showProject && (
              <div className="space-y-1">
                <Label className="text-xs">Projekt</Label>
                <Select value={filters.projectId || 'all'} onValueChange={(val) => handleFilterChange('projectId', val)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Všechny" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Všechny</SelectItem>
                    {options.projects?.map(p => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {showStatus && (
              <div className="space-y-1">
                <Label className="text-xs">Stav</Label>
                <Select value={filters.status || 'all'} onValueChange={(val) => handleFilterChange('status', val)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Všechny" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Všechny</SelectItem>
                    <SelectItem value="active">Aktivní</SelectItem>
                    <SelectItem value="pending">Čekající</SelectItem>
                    <SelectItem value="completed">Dokončeno</SelectItem>
                    <SelectItem value="paid">Zaplaceno</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            
            {showCategory && (
              <div className="space-y-1">
                <Label className="text-xs">Kategorie</Label>
                <Select value={filters.category || 'all'} onValueChange={(val) => handleFilterChange('category', val)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Všechny" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Všechny</SelectItem>
                    <SelectItem value="project">Projektové</SelectItem>
                    <SelectItem value="overhead">Režijní</SelectItem>
                    <SelectItem value="subcontractor">Subdodávky</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default ReportFilters;