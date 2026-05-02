import React, { useState, useEffect } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '@/components/ui/checkbox';
import { X, Plus, Trash2 } from 'lucide-react';

const OverheadCostForm = ({ isOpen, onClose, onSave, cost, allCategories }) => {
  const { toast } = useToast();
  const { register, handleSubmit, control, watch, setValue, formState: { errors } } = useForm({
    defaultValues: cost || { type: 'PRAVIDELNY', amount: 0, default_allocation_key: { type: 'none', allocations: [] } }
  });
  const [projects, setProjects] = useState([]);
  const [showAllocation, setShowAllocation] = useState(!!cost?.default_allocation_key && cost.default_allocation_key.type !== 'none');

  const costType = watch('type');
  const allocationType = watch('default_allocation_key.type');
  const allocations = watch('default_allocation_key.allocations') || [];
  
  useEffect(() => {
    const fetchProjects = async () => {
      const { data, error } = await supabase.from('projects').select('id, name, code').order('code');
      if (error) toast({ title: 'Chyba při načítání projektů', variant: 'destructive' });
      else setProjects(data);
    };
    fetchProjects();
  }, [toast]);
  
  useEffect(() => {
      if (cost) {
          Object.keys(cost).forEach(key => setValue(key, cost[key]));
          setShowAllocation(!!cost.default_allocation_key && cost.default_allocation_key.type !== 'none');
      } else {
          setValue('type', 'PRAVIDELNY');
          setValue('amount', 0);
          setValue('default_allocation_key', { type: 'none', allocations: [] });
          setShowAllocation(false);
      }
  }, [cost, setValue]);

  const onSubmit = (data) => {
    // Clean up dates based on type
    if (data.type === 'PRAVIDELNY') {
      data.date_incurred = null;
    } else {
      data.valid_from = null;
      data.valid_to = null;
    }

    // Clean up allocation key
    if (!showAllocation) {
        data.default_allocation_key = { type: 'none', allocations: [] };
    }
    
    // Ensure numeric amount
    data.amount = parseFloat(data.amount);

    onSave(data);
  };
  
  const addAllocation = () => {
    const currentAllocations = watch('default_allocation_key.allocations') || [];
    setValue('default_allocation_key.allocations', [...currentAllocations, { project_id: '', value: 0 }]);
  };

  const removeAllocation = (index) => {
    const currentAllocations = watch('default_allocation_key.allocations');
    setValue('default_allocation_key.allocations', currentAllocations.filter((_, i) => i !== index));
  };
  
  const totalPercentage = allocations.reduce((sum, alloc) => sum + (parseFloat(alloc.value) || 0), 0);
  
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{cost?.id && !cost.name.endsWith('(Kopie)') ? 'Upravit režijní náklad' : 'Nový režijní náklad'}</DialogTitle>
          <DialogDescription>
            Zadejte podrobnosti o pravidelném nebo proměnlivém nákladu.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4 py-4 max-h-[70vh] overflow-y-auto pr-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="name" className="text-right">Název</Label>
            <Input id="name" {...register('name', { required: 'Název je povinný' })} className="col-span-3" />
            {errors.name && <p className="col-span-4 text-red-500 text-sm text-right">{errors.name.message}</p>}
          </div>

          <div className="grid grid-cols-4 items-start gap-4">
            <Label htmlFor="description" className="text-right pt-2">Popis</Label>
            <Textarea id="description" {...register('description')} className="col-span-3" />
          </div>
          
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">Typ nákladu</Label>
            <Controller name="type" control={control} render={({ field }) => (
              <RadioGroup onValueChange={field.onChange} value={field.value} className="col-span-3 flex gap-4">
                <div className="flex items-center space-x-2"><RadioGroupItem value="PRAVIDELNY" id="r1" /><Label htmlFor="r1">Pravidelný</Label></div>
                <div className="flex items-center space-x-2"><RadioGroupItem value="PROMENLIVY" id="r2" /><Label htmlFor="r2">Proměnlivý</Label></div>
              </RadioGroup>
            )} />
          </div>
          
          {costType === 'PRAVIDELNY' && (
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">Platnost</Label>
              <div className="col-span-3 grid grid-cols-2 gap-2">
                <Input type="date" {...register('valid_from', { required: 'Datum od je povinné' })} />
                <Input type="date" {...register('valid_to', { required: 'Datum do je povinné' })} />
              </div>
              {(errors.valid_from || errors.valid_to) && <p className="col-span-4 text-red-500 text-sm text-right">{errors.valid_from?.message || errors.valid_to?.message}</p>}
            </div>
          )}

          {costType === 'PROMENLIVY' && (
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="date_incurred" className="text-right">Datum vzniku</Label>
              <Input id="date_incurred" type="date" {...register('date_incurred', { required: 'Datum vzniku je povinné' })} className="col-span-3" />
              {errors.date_incurred && <p className="col-span-4 text-red-500 text-sm text-right">{errors.date_incurred.message}</p>}
            </div>
          )}

          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="amount" className="text-right">Částka (Kč)</Label>
            <Input id="amount" type="number" step="0.01" {...register('amount', { required: 'Částka je povinná', valueAsNumber: true })} className="col-span-3" />
            {errors.amount && <p className="col-span-4 text-red-500 text-sm text-right">{errors.amount.message}</p>}
          </div>

          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="category" className="text-right">Kategorie</Label>
            <Input id="category" {...register('category')} list="categories" className="col-span-3" />
            <datalist id="categories">
                {allCategories.map(cat => <option key={cat} value={cat} />)}
            </datalist>
          </div>
          
          <div className="flex items-center space-x-2 mt-4">
            <Checkbox id="show-allocation" checked={showAllocation} onCheckedChange={setShowAllocation} />
            <label htmlFor="show-allocation" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
              Nastavit výchozí alokační klíč
            </label>
          </div>
          
          {showAllocation && (
            <div className="pl-6 border-l-2 mt-2 space-y-4">
              <div className="grid grid-cols-4 items-center gap-4">
                <Label className="text-right">Typ klíče</Label>
                <Controller name="default_allocation_key.type" control={control} render={({ field }) => (
                  <Select onValueChange={field.onChange} value={field.value}>
                    <SelectTrigger className="col-span-3"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="percentage">Procentuální</SelectItem>
                      <SelectItem value="manual">Částkou</SelectItem>
                    </SelectContent>
                  </Select>
                )} />
              </div>

              {allocations.map((alloc, index) => (
                <div key={index} className="grid grid-cols-12 items-center gap-2">
                  <Controller name={`default_allocation_key.allocations.${index}.project_id`} control={control} render={({ field }) => (
                    <Select onValueChange={field.onChange} value={field.value}>
                      <SelectTrigger className="col-span-6"><SelectValue placeholder="Vyberte projekt..." /></SelectTrigger>
                      <SelectContent>
                        {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.code} - {p.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )} />
                  <Input type="number" {...register(`default_allocation_key.allocations.${index}.value`, { valueAsNumber: true })} className="col-span-4" placeholder={allocationType === 'percentage' ? '%' : 'Kč'} />
                  <Button type="button" variant="ghost" size="icon" onClick={() => removeAllocation(index)} className="col-span-2 text-red-500"><Trash2 className="w-4 h-4" /></Button>
                </div>
              ))}
              
              <Button type="button" variant="outline" size="sm" onClick={addAllocation}><Plus className="mr-2 h-4 w-4" /> Přidat projekt</Button>
              
              {allocationType === 'percentage' && (
                <div className={`text-sm text-right ${totalPercentage !== 100 ? 'text-red-500' : 'text-green-600'}`}>
                  Celkem: {totalPercentage.toFixed(2)} %
                </div>
              )}
            </div>
          )}

          <DialogFooter className="pt-4">
            <Button type="button" variant="ghost" onClick={onClose}>Zrušit</Button>
            <Button type="submit">Uložit náklad</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default OverheadCostForm;