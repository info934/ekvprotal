import React, { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Plus, AlertCircle, X } from "lucide-react";
import { supabase } from "@/lib/customSupabaseClient";
import { useToast } from "@/components/ui/use-toast";
import SubjectDialog from '@/components/SubjectDialog';
import { Label } from "@/components/ui/label";
import CustomSelect from './CustomSelect';

const SubjectSelect = ({
  value,
  onChange,
  label,
  placeholder = "Vybrat subjekt...",
  disabled = false,
  excludeIds = [],
}) => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const { toast } = useToast();

  const fetchSubjects = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error } = await supabase
        .from('subjects')
        .select('id, name, ico, city:address') 
        .order('name');

      if (error) throw error;
      
      const formattedItems = (data || []).map(item => ({
        id: item.id,
        label: item.name,
        description: item.ico ? `IČO: ${item.ico}` : (item.city ? item.city : 'Subjekt')
      }));

      setItems(formattedItems);
    } catch (err) {
      console.error("SubjectSelect: Error fetching subjects:", err);
      setError("Chyba načítání");
      toast({
        title: "Chyba načítání",
        description: "Nepodařilo se načíst seznam subjektů.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSubjects();
  }, []);

  const handleSaveSubject = async (formData) => {
    try {
        const { data, error } = await supabase
            .from('subjects')
            .insert([formData])
            .select()
            .single();

        if (error) throw error;

        const formattedItem = {
            id: data.id,
            label: data.name,
            description: data.ico ? `IČO: ${data.ico}` : 'Nový subjekt'
        };

        setItems(prev => [...prev, formattedItem].sort((a, b) => a.label.localeCompare(b.label)));
        onChange(data.id);
        setIsDialogOpen(false);
        return data;
    } catch (error) {
        console.error("Error creating subject:", error);
        throw error;
    }
  };

  const visibleItems = items.filter(item => !excludeIds.includes(item.id));

  return (
    <div className="space-y-2 w-full">
      {label && <Label className="text-slate-700 font-medium">{label}</Label>}
      <div className="flex gap-2 relative z-0 w-full items-center">
        <div className="flex-grow min-w-0">
          <CustomSelect
            items={visibleItems}
            value={value}
            onChange={onChange}
            placeholder={placeholder}
            searchPlaceholder="Hledat firmu nebo IČO..."
            disabled={disabled}
            loading={loading}
            error={error}
            themeColor="amber"
          />
        </div>
        
        {value && !disabled && (
          <Button 
            type="button" 
            variant="ghost" 
            size="icon" 
            onClick={() => onChange(null)}
            title="Zrušit výběr"
            className="shrink-0 h-10 w-10 text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
          >
            <X className="h-4 w-4" />
          </Button>
        )}

        <Button 
          type="button" 
          variant="outline" 
          size="icon" 
          onClick={() => setIsDialogOpen(true)}
          title="Vytvořit nový subjekt"
          disabled={disabled}
          className="shrink-0 h-10 w-10 hover:bg-amber-50 border-input hover:border-amber-200 hover:text-amber-600 transition-colors"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {error && (
         <div className="flex items-center gap-2 text-xs text-red-500 mt-1 animate-in slide-in-from-left-2 duration-300">
             <AlertCircle className="w-3 h-3" />
             <span>{error}</span>
             <Button variant="link" size="sm" className="h-auto p-0 text-xs text-red-600 underline" onClick={fetchSubjects}>Zkusit znovu</Button>
         </div>
      )}
      
      <SubjectDialog 
        isOpen={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
        onSave={handleSaveSubject}
      />
    </div>
  );
};

export default SubjectSelect;