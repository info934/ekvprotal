import React, { useState, useEffect } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { FormDialogBody, FormDialogContent, FormDialogFooter, FormDialogHeader } from '@/components/ui/form-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { Plus, Trash2, Loader2 } from 'lucide-react';

const createEmptyRow = () => ({
  id: crypto.randomUUID(),
  name: '',
  code: '',
  price: '',
  budget_percentage: '',
  client_id: '',
  start_date: '',
  completion_date: ''
});

export default function BatchProjectDialog({ open, onOpenChange, onProjectsCreated }) {
  const { toast } = useToast();
  const { memberId } = useAuth();
  const [rows, setRows] = useState([createEmptyRow()]);
  const [subjects, setSubjects] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingSubjects, setIsLoadingSubjects] = useState(false);

  useEffect(() => {
    if (open) {
      setRows([createEmptyRow()]);
      fetchSubjects();
    }
  }, [open]);

  const fetchSubjects = async () => {
    setIsLoadingSubjects(true);
    try {
      const { data, error } = await supabase
        .from('subjects')
        .select('id, name')
        .order('name');
      if (error) throw error;
      setSubjects(data || []);
    } catch (error) {
      console.error('Error fetching subjects:', error);
      toast({ title: 'Chyba načítání subjektů', description: error.message, variant: 'destructive' });
    } finally {
      setIsLoadingSubjects(false);
    }
  };

  const updateRow = (id, field, value) => {
    setRows(current => current.map(row => row.id === id ? { ...row, [field]: value } : row));
  };

  const addRow = () => {
    setRows(current => [...current, createEmptyRow()]);
  };

  const removeRow = (id) => {
    if (rows.length > 1) {
      setRows(current => current.filter(row => row.id !== id));
    }
  };

  const validateRows = () => {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 1;

      if (!row.name.trim()) return `Řádek ${rowNum}: Název projektu je povinný`;
      if (!row.code.trim()) return `Řádek ${rowNum}: Kód projektu je povinný`;
      if (!row.price || isNaN(row.price) || Number(row.price) <= 0) return `Řádek ${rowNum}: Cena musí být kladné číslo`;
      if (!row.budget_percentage || isNaN(row.budget_percentage) || Number(row.budget_percentage) < 0 || Number(row.budget_percentage) > 100) return `Řádek ${rowNum}: Rozpočet musí být 0-100`;
      if (!row.client_id) return `Řádek ${rowNum}: Zadavatel je povinný`;
      if (!row.start_date) return `Řádek ${rowNum}: Datum start je povinné`;
      if (!row.completion_date) return `Řádek ${rowNum}: Datum konec je povinné`;

      if (new Date(row.start_date) > new Date(row.completion_date)) {
        return `Řádek ${rowNum}: Datum start musí být před datem konce`;
      }
    }
    return null;
  };

  const handleSubmit = async () => {
    const errorMsg = validateRows();
    if (errorMsg) {
      toast({ title: 'Chyba validace', description: errorMsg, variant: 'destructive' });
      return;
    }

    setIsSubmitting(true);
    try {
      const projectsToInsert = rows.map(row => ({
        name: row.name.trim(),
        code: row.code.trim(),
        status: 'nabidka',
        price: Number(row.price),
        budget_percentage: Number(row.budget_percentage),
        overhead_percentage: 10, // Default overhead
        client_id: row.client_id,
        investor_id: row.client_id, // Set investor same as client for batch creation
        start_date: row.start_date,
        completion_date: row.completion_date,
        created_by_member_id: memberId,
        type: 'Nezadáno'
      }));

      const { error } = await supabase.from('projects').insert(projectsToInsert);
      if (error) throw error;

      toast({ title: 'Úspěch', description: `Vytvořeno ${rows.length} projektů.`, variant: 'default' });
      if (onProjectsCreated) onProjectsCreated();
      onOpenChange(false);
    } catch (error) {
      console.error('Error inserting projects:', error);
      toast({ title: 'Chyba při vytváření', description: error.message, variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <FormDialogContent size="xl">
        <FormDialogHeader icon={Plus} title="Vytvořit více projektů" />

        <FormDialogBody className="overflow-x-auto">
          <table className="w-full text-sm text-left border-collapse">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-2 py-2 font-medium min-w-[150px]">Kód *</th>
                <th className="px-2 py-2 font-medium min-w-[200px]">Název *</th>
                <th className="px-2 py-2 font-medium min-w-[120px]">Cena (Kč) *</th>
                <th className="px-2 py-2 font-medium min-w-[100px]">Rozpočet % *</th>
                <th className="px-2 py-2 font-medium min-w-[200px]">Zadavatel *</th>
                <th className="px-2 py-2 font-medium min-w-[140px]">Datum start *</th>
                <th className="px-2 py-2 font-medium min-w-[140px]">Datum konec *</th>
                <th className="px-2 py-2 font-medium w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="px-2 py-2">
                    <Input 
                      value={row.code} 
                      onChange={(e) => updateRow(row.id, 'code', e.target.value)} 
                      placeholder="Kód" 
                      className="h-8 text-sm"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <Input 
                      value={row.name} 
                      onChange={(e) => updateRow(row.id, 'name', e.target.value)} 
                      placeholder="Název" 
                      className="h-8 text-sm"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <Input 
                      type="number" 
                      value={row.price} 
                      onChange={(e) => updateRow(row.id, 'price', e.target.value)} 
                      placeholder="0" 
                      className="h-8 text-sm"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <Input 
                      type="number" 
                      value={row.budget_percentage} 
                      onChange={(e) => updateRow(row.id, 'budget_percentage', e.target.value)} 
                      placeholder="30" 
                      className="h-8 text-sm"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <Select value={row.client_id} onValueChange={(val) => updateRow(row.id, 'client_id', val)}>
                      <SelectTrigger className="h-8 text-sm w-full">
                        <SelectValue placeholder="Vyberte zadavatele" />
                      </SelectTrigger>
                      <SelectContent>
                        {isLoadingSubjects ? (
                          <div className="p-2 text-sm text-muted-foreground flex items-center"><Loader2 className="w-4 h-4 mr-2 animate-spin"/> Načítání...</div>
                        ) : (
                          subjects.map(sub => (
                            <SelectItem key={sub.id} value={sub.id}>{sub.name}</SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-2 py-2">
                    <Input 
                      type="date" 
                      value={row.start_date} 
                      onChange={(e) => updateRow(row.id, 'start_date', e.target.value)} 
                      className="h-8 text-sm"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <Input 
                      type="date" 
                      value={row.completion_date} 
                      onChange={(e) => updateRow(row.id, 'completion_date', e.target.value)} 
                      className="h-8 text-sm"
                    />
                  </td>
                  <td className="px-2 py-2 text-center">
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      onClick={() => removeRow(row.id)}
                      disabled={rows.length === 1}
                      className="h-8 w-8 text-red-500 hover:text-red-700 hover:bg-red-50"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </FormDialogBody>

        <FormDialogFooter className="flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Button variant="outline" onClick={addRow} type="button" className="flex items-center gap-2">
            <Plus className="w-4 h-4" />
            Přidat řádek
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Zrušit
            </Button>
            <Button onClick={handleSubmit} disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Vytvořit projekty
            </Button>
          </div>
        </FormDialogFooter>
      </FormDialogContent>
    </Dialog>
  );
}
