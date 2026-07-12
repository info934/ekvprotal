import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { format, parse, startOfMonth, endOfMonth, subMonths, addMonths } from 'date-fns';
import { cs } from 'date-fns/locale';
import {
  ArrowLeft, ArrowRight,
  FilePieChart, ChevronDown, ChevronUp, Sparkles
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import AllocationWorkflow from '@/components/AllocationWorkflow';
import { calculateProjectBudget } from '@/domain/financials';
import PageHeader from '@/components/ui/page-header';

const ProjectAllocationInput = ({ project, costId, allocationItems, setAllocationItems }) => {
  const { toast } = useToast();
  const currentAllocationValue = allocationItems.find(item => item.overhead_cost_id === costId && item.project_id === project.id)?.amount_allocated || '';

  const handleAllocationChange = (newAmount) => {
    const parsedAmount = parseFloat(newAmount) || 0;
    const remainingBudget = project.overhead_budget - project.allocated_overhead;

    // The remaining budget check should consider the value *currently* in the input for this cost
    const otherAllocationsForThisCost = allocationItems.filter(item => item.project_id === project.id && item.overhead_cost_id !== costId);
    const otherAllocatedAmount = otherAllocationsForThisCost.reduce((sum, item) => sum + parseFloat(item.amount_allocated), 0);

    if (parsedAmount > (project.overhead_budget - otherAllocatedAmount)) {
      toast({
        title: 'Překročen rozpočet',
        description: `Pro projekt ${project.code} zbývá na režii jen ${(project.overhead_budget - project.allocated_overhead).toLocaleString('cs-CZ')} Kč.`,
        variant: 'destructive',
      });
      // Cap the value instead of rejecting
      newAmount = (project.overhead_budget - project.allocated_overhead + (parseFloat(currentAllocationValue) || 0));
      newAmount = Math.max(0, newAmount).toString();
    }


    setAllocationItems(currentItems => {
      const existingItemIndex = currentItems.findIndex(item => item.overhead_cost_id === costId && item.project_id === project.id);
      if (existingItemIndex > -1) {
        if (parsedAmount > 0) {
          const updatedItems = [...currentItems];
          updatedItems[existingItemIndex] = { ...updatedItems[existingItemIndex], amount_allocated: newAmount };
          return updatedItems;
        } else {
          return currentItems.filter((_, index) => index !== existingItemIndex);
        }
      } else if (parsedAmount > 0) {
        return [...currentItems, { overhead_cost_id: costId, project_id: project.id, amount_allocated: newAmount }];
      }
      return currentItems;
    });
  };

  return (
    <div className="grid grid-cols-12 items-center gap-2">
      <Label className="col-span-6 truncate flex flex-col">
        {project.code} - {project.name}
        <span className="text-xs text-muted-foreground">
          Zbývá na režii: {(project.overhead_budget - project.allocated_overhead).toLocaleString('cs-CZ')} Kč
        </span>
      </Label>
      <div className="col-span-6">
        <Input
          type="number"
          step="0.01"
          placeholder="Částka v Kč"
          value={currentAllocationValue}
          onChange={(e) => handleAllocationChange(e.target.value)}
          max={project.overhead_budget - project.allocated_overhead + (parseFloat(currentAllocationValue) || 0)}
          className={parseFloat(currentAllocationValue) > (project.overhead_budget - project.allocated_overhead + (parseFloat(currentAllocationValue) || 0)) ? 'border-red-500' : ''}
        />
      </div>
    </div>
  );
};


const AllocationItem = ({ cost, projectsWithBudgets, allocationItems, setAllocationItems }) => {
  const [isOpen, setIsOpen] = useState(true);
  const itemsForCost = allocationItems.filter(item => item.overhead_cost_id === cost.id);
  const totalAllocated = itemsForCost.reduce((sum, item) => sum + (parseFloat(item.amount_allocated) || 0), 0);
  const isFullyAllocated = Math.abs(totalAllocated - cost.amount) < 0.01;
  const remainingAmount = cost.amount - totalAllocated;

  const applyDefaultKey = () => {
    if (!cost.default_allocation_key || cost.default_allocation_key.type === 'none') return;
    
    const { type, allocations } = cost.default_allocation_key;
    let newItems = [];

    if (type === 'percentage') {
        newItems = allocations.map(alloc => ({
            overhead_cost_id: cost.id,
            project_id: alloc.project_id,
            amount_allocated: (cost.amount * (alloc.value / 100)).toFixed(2)
        }));
    } else { // manual
        newItems = allocations.map(alloc => ({
            overhead_cost_id: cost.id,
            project_id: alloc.project_id,
            amount_allocated: alloc.value
        }));
    }

    setAllocationItems(currentItems => {
        const otherCostItems = currentItems.filter(item => item.overhead_cost_id !== cost.id);
        const finalItems = [...otherCostItems];

        // Add new items, respecting budget constraints
        newItems.forEach(newItem => {
          const project = projectsWithBudgets.find(p => p.id === newItem.project_id);
          const currentItemInState = finalItems.find(i => i.project_id === newItem.project_id && i.overhead_cost_id === newItem.overhead_cost_id);
          
          const currentAllocatedForProject = finalItems
              .filter(i => i.project_id === newItem.project_id)
              .reduce((sum, i) => sum + parseFloat(i.amount_allocated || 0), 0);
              
          const remainingBudget = project.overhead_budget - currentAllocatedForProject + (parseFloat(currentItemInState?.amount_allocated) || 0);
          
          if (parseFloat(newItem.amount_allocated) <= remainingBudget) {
              const existingIndex = finalItems.findIndex(i => i.project_id === newItem.project_id && i.overhead_cost_id === newItem.overhead_cost_id);
              if (existingIndex !== -1) {
                  finalItems[existingIndex] = newItem;
              } else {
                  finalItems.push(newItem);
              }
          }
        });
        return finalItems;
    });
  };

  return (
    <Card className="mb-4">
      <CardHeader className="p-4 cursor-pointer" onClick={() => setIsOpen(!isOpen)}>
        <div className="flex justify-between items-center">
          <div className="flex-1">
            <p className="font-semibold">{cost.name} <Badge variant="secondary" className="ml-2">{cost.type === 'PRAVIDELNY' ? 'Pravidelný' : 'Proměnlivý'}</Badge></p>
            <p className="text-sm text-muted-foreground">{cost.category} - {cost.amount.toLocaleString('cs-CZ')} Kč</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={isFullyAllocated ? 'success' : 'warning'}>
              {isFullyAllocated ? 'Rozděleno' : 'K rozdělení'}
            </Badge>
            {isOpen ? <ChevronUp /> : <ChevronDown />}
          </div>
        </div>
      </CardHeader>
      {isOpen && (
        <CardContent className="p-4 space-y-3">
          <div className="flex justify-between items-center p-2 bg-slate-50 rounded-md">
            <div>
              <p className="text-sm">Celkem k rozdělení: <strong>{cost.amount.toLocaleString('cs-CZ')} Kč</strong></p>
              <p className={`text-sm ${isFullyAllocated ? 'text-green-600' : 'text-orange-600'}`}>
                Zbývá: <strong>{remainingAmount.toLocaleString('cs-CZ')} Kč</strong>
              </p>
            </div>
            {cost.default_allocation_key?.type !== 'none' && (
              <Button size="sm" variant="outline" onClick={applyDefaultKey}>
                <Sparkles className="mr-2 h-4 w-4" /> Použít klíč
              </Button>
            )}
          </div>
          <div className="space-y-2">
            {projectsWithBudgets.map(project => (
              <ProjectAllocationInput 
                  key={project.id}
                  project={project}
                  costId={cost.id}
                  allocationItems={allocationItems}
                  setAllocationItems={setAllocationItems}
              />
            ))}
          </div>
        </CardContent>
      )}
    </Card>
  );
};

const MonthlyAllocation = () => {
  const { month } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [currentMonth, setCurrentMonth] = useState(month === 'current' ? format(new Date(), 'yyyy-MM') : month || format(new Date(), 'yyyy-MM'));
  const [costs, setCosts] = useState([]);
  const [projectsWithBudgets, setProjectsWithBudgets] = useState([]);
  const [allocation, setAllocation] = useState(null);
  const [allocationItems, setAllocationItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchMonthData = useCallback(async (selectedMonth) => {
    setLoading(true);
    try {
      // Fetch or create monthly allocation record
      let { data: allocData, error: allocError } = await supabase
        .from('overhead_monthly_allocations').select('*').eq('month', selectedMonth).maybeSingle();
      if (allocError) throw allocError;
      if (!allocData) {
        const { data: newAlloc, error: newAllocError } = await supabase.rpc('save_overhead_allocation_draft', {
          p_month: selectedMonth,
          p_items: [],
          p_notes: null,
        });
        if (newAllocError) throw newAllocError;
        allocData = newAlloc;
      }
      setAllocation(allocData);
      
      const { data: itemsData, error: itemsError } = await supabase.from('overhead_allocation_items').select('*').eq('overhead_monthly_allocation_id', allocData.id);
      if (itemsError) throw itemsError;
      setAllocationItems(itemsData);

      const monthStart = startOfMonth(parse(selectedMonth, 'yyyy-MM', new Date()));
      const monthEnd = endOfMonth(monthStart);
      const { data: costsData, error: costsError } = await supabase.from('overhead_costs').select('*').or(`and(type.eq.PRAVIDELNY,valid_from.lte.${format(monthEnd, 'yyyy-MM-dd')},valid_to.gte.${format(monthStart, 'yyyy-MM-dd')}),and(type.eq.PROMENLIVY,date_incurred.gte.${format(monthStart, 'yyyy-MM-dd')},date_incurred.lte.${format(monthEnd, 'yyyy-MM-dd')})`);
      if (costsError) throw costsError;
      setCosts(costsData);

      const { data: projectsData, error: projectsError } = await supabase.rpc('list_projects_safe');
      if (projectsError) throw projectsError;
      
      const { data: allocatedOverheads, error: overheadsError } = await supabase.from('project_overhead_costs').select('project_id, amount');
      if(overheadsError) throw overheadsError;

      const projectsWithCalculatedBudgets = [...(projectsData || [])].sort((a, b) => String(a.code || '').localeCompare(String(b.code || ''), 'cs')).map(p => {
        const { overheadBudget } = calculateProjectBudget(p);
        const alreadyAllocated = allocatedOverheads.filter(ao => ao.project_id === p.id).reduce((sum, ao) => sum + (ao.amount || 0), 0);
        
        // When calculating remaining budget, we need to subtract only allocations *not* from the current draft
        const allocationsForThisProjectInDraft = itemsData.filter(i => i.project_id === p.id).reduce((sum, i) => sum + (parseFloat(i.amount_allocated) || 0), 0);
        const allocated_overhead_excluding_draft = alreadyAllocated - allocationsForThisProjectInDraft;


        return { ...p, overhead_budget: overheadBudget, allocated_overhead: allocated_overhead_excluding_draft };
      });
      setProjectsWithBudgets(projectsWithCalculatedBudgets);

    } catch (error) {
        toast({ title: 'Chyba při načítání dat', description: error.message, variant: 'destructive' });
    } finally {
        setLoading(false);
    }
  }, [toast]);

  // Update project budgets in real time as user types
  const projectsWithLiveBudgets = useMemo(() => {
    return projectsWithBudgets.map(p => {
      const liveAllocated = allocationItems
        .filter(item => item.project_id === p.id)
        .reduce((sum, item) => sum + (parseFloat(item.amount_allocated) || 0), 0);
      return { ...p, allocated_overhead: p.allocated_overhead + liveAllocated };
    });
  }, [projectsWithBudgets, allocationItems]);

  useEffect(() => {
    fetchMonthData(currentMonth);
  }, [currentMonth, fetchMonthData]);
  
  const handleSaveDraft = async () => {
    if (!allocation) return;
    const itemsToUpsert = allocationItems.map(item => ({
      overhead_monthly_allocation_id: allocation.id, overhead_cost_id: item.overhead_cost_id, project_id: item.project_id, amount_allocated: parseFloat(item.amount_allocated) || 0,
    })).filter(item => item.amount_allocated > 0);

    const { data, error } = await supabase.rpc('save_overhead_allocation_draft', {
      p_month: currentMonth,
      p_items: itemsToUpsert.map(({ overhead_monthly_allocation_id, ...item }) => item),
      p_notes: allocation.notes || null,
    });
    
    if (error) {
      toast({ title: 'Chyba při ukládání', description: error.message, variant: 'destructive' });
      throw error;
    }
    if (data) setAllocation(data);
    toast({ title: '✅ Koncept uložen' });
    await fetchMonthData(currentMonth);
  };

  const changeMonth = (direction) => {
    const newDate = direction === 'prev' ? subMonths(parse(currentMonth, 'yyyy-MM', new Date()), 1) : addMonths(parse(currentMonth, 'yyyy-MM', new Date()), 1);
    const newMonth = format(newDate, 'yyyy-MM');
    setCurrentMonth(newMonth);
    if(month) navigate(`/overhead-costs/allocation/${newMonth}`);
  };

  if (loading) return <div className="flex justify-center items-center h-96">Načítání...</div>;
  
  return (
    <div className="space-y-6">
      <PageHeader
        icon={FilePieChart}
        title="Měsíční vyúčtování režie"
        actions={
          <div className="flex items-center gap-2 bg-white p-2 rounded-lg border">
            <Button variant="ghost" size="icon" onClick={() => changeMonth('prev')}><ArrowLeft /></Button>
            <span className="font-semibold text-lg w-48 text-center capitalize">{format(parse(currentMonth, 'yyyy-MM', new Date()), 'LLLL yyyy', { locale: cs })}</span>
            <Button variant="ghost" size="icon" onClick={() => changeMonth('next')}><ArrowRight /></Button>
          </div>
        }
      />
      <div className="hidden">
        <h1 className="text-3xl font-bold text-slate-800 flex items-center gap-3">
          <FilePieChart className="w-8 h-8 text-primary" /> Měsíční vyúčtování režie
        </h1>
        <div className="flex items-center gap-2 bg-white p-2 rounded-lg border">
          <Button variant="ghost" size="icon" onClick={() => changeMonth('prev')}><ArrowLeft /></Button>
          <span className="font-semibold text-lg w-48 text-center capitalize">{format(parse(currentMonth, 'yyyy-MM', new Date()), 'LLLL yyyy', { locale: cs })}</span>
          <Button variant="ghost" size="icon" onClick={() => changeMonth('next')}><ArrowRight /></Button>
        </div>
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader><CardTitle>Náklady k rozdělení</CardTitle></CardHeader>
            <CardContent>
              {costs.length > 0 ? costs.map(cost => (
                <AllocationItem key={cost.id} cost={cost} projectsWithBudgets={projectsWithLiveBudgets} allocationItems={allocationItems} setAllocationItems={setAllocationItems} />
              )) : <p className="text-muted-foreground p-8 text-center">Pro tento měsíc nebyly nalezeny žádné náklady.</p>}
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-1 space-y-6">
          <Card>
            <CardHeader><CardTitle>Stav a Akce</CardTitle></CardHeader>
            <CardContent>
              <AllocationWorkflow allocation={allocation} onUpdate={() => fetchMonthData(currentMonth)} onSaveDraft={handleSaveDraft} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default MonthlyAllocation;
