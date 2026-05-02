import React, { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Plus, AlertCircle } from "lucide-react";
import { supabase } from "@/lib/customSupabaseClient";
import { useToast } from "@/components/ui/use-toast";
import CreateMemberDialog from './CreateMemberDialog';
import { Label } from "@/components/ui/label";
import CustomSelect from './CustomSelect';

const MemberSelect = ({
  value,
  onChange,
  label,
  placeholder = "Vybrat člena...",
  disabled = false,
  excludeIds = [],
}) => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const { toast } = useToast();

  const fetchMembers = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error } = await supabase
        .from('members')
        .select('id, name, email, user_role, job_title')
        .order('name');

      if (error) throw error;
      
      const formattedItems = (data || []).map(item => ({
        id: item.id,
        label: item.name,
        description: item.job_title || item.email || item.user_role || 'Člen týmu'
      }));

      setItems(formattedItems);
    } catch (err) {
      console.error("MemberSelect: Error fetching members:", err);
      setError("Chyba načítání");
      toast({
        title: "Chyba načítání",
        description: "Nepodařilo se načíst seznam členů.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMembers();
  }, []);

  const handleCreateSuccess = (newItem) => {
    const formattedItem = {
        id: newItem.id,
        label: newItem.name,
        description: newItem.job_title || newItem.email || 'Nový člen'
    };
    
    setItems(prev => [...prev, formattedItem].sort((a, b) => a.label.localeCompare(b.label)));
    onChange(newItem.id);
    setIsDialogOpen(false);
  };

  const visibleItems = items.filter(item => !excludeIds.includes(item.id));

  return (
    <div className="space-y-2">
      {label && <Label>{label}</Label>}
      <div className="flex gap-2 relative z-0"> {/* z-0 ensures dialogs overlay correctly */}
        <div className="flex-grow">
            <CustomSelect
                items={visibleItems}
                value={value}
                onChange={onChange}
                placeholder={placeholder}
                searchPlaceholder="Hledat jméno..."
                disabled={disabled}
                loading={loading}
                error={error}
                themeColor="blue"
            />
        </div>
        <Button 
          type="button" 
          variant="outline" 
          size="icon" 
          onClick={() => setIsDialogOpen(true)}
          title="Vytvořit nového člena"
          disabled={disabled}
          className="shrink-0 aspect-square hover:bg-blue-50 border-input hover:border-blue-200 hover:text-blue-600 transition-colors"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      
      {error && (
         <div className="flex items-center gap-2 text-xs text-red-500 mt-1 animate-in slide-in-from-left-2 duration-300">
             <AlertCircle className="w-3 h-3" />
             <span>{error}</span>
             <Button variant="link" size="sm" className="h-auto p-0 text-xs text-red-600 underline" onClick={fetchMembers}>Zkusit znovu</Button>
         </div>
      )}

      <CreateMemberDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        onSuccess={handleCreateSuccess}
        entityType="member"
      />
    </div>
  );
};

export default MemberSelect;