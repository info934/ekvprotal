import React, { useState } from 'react';
import { Edit2, Save, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { cn } from '@/lib/utils';

const EditablePercentageField = ({ 
  realizaceId, 
  fieldName, 
  currentValue, 
  onUpdate, 
  label,
  canEdit = true,
  placeholderText = "Není nastaveno"
}) => {
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState(currentValue || '');
  const [loading, setLoading] = useState(false);

  const handleEdit = () => {
    setValue(currentValue || '');
    setIsEditing(true);
  };

  const handleCancel = () => {
    setValue(currentValue || '');
    setIsEditing(false);
  };

  const handleSave = async () => {
    if (!realizaceId) {
      toast({ 
        title: 'Chyba', 
        description: 'ID realizace není dostupné.', 
        variant: 'destructive' 
      });
      return;
    }

    const numericValue = value === '' ? null : parseFloat(value);
    
    if (numericValue !== null && (isNaN(numericValue) || numericValue < 0 || numericValue > 100)) {
      toast({ 
        title: 'Neplatná hodnota', 
        description: 'Zadejte číslo mezi 0 a 100.', 
        variant: 'destructive' 
      });
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase
        .from('realizations')
        .update({ [fieldName]: numericValue })
        .eq('id', realizaceId);

      if (error) throw error;

      toast({ 
        title: 'Uloženo', 
        description: `${label} bylo úspěšně aktualizováno.`,
        className: 'bg-green-100 text-green-800'
      });

      setIsEditing(false);
      if (onUpdate) onUpdate(numericValue);

    } catch (error) {
      console.error('Error updating percentage:', error);
      toast({ 
        title: 'Chyba při ukládání', 
        description: error.message, 
        variant: 'destructive' 
      });
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      handleSave();
    } else if (e.key === 'Escape') {
      handleCancel();
    }
  };

  if (!canEdit) {
    return (
      <div className="flex items-center gap-2">
        {currentValue !== null && currentValue !== undefined ? (
          <span className="text-2xl font-bold">{currentValue}%</span>
        ) : (
          <span className="text-lg text-muted-foreground italic">{placeholderText}</span>
        )}
      </div>
    );
  }

  if (isEditing) {
    return (
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-[120px]">
          <Input
            type="number"
            step="0.01"
            min="0"
            max="100"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            className="pr-8 text-lg font-semibold"
            placeholder="0.00"
            autoFocus
            disabled={loading}
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground font-medium">
            %
          </span>
        </div>
        <Button 
          size="sm" 
          variant="ghost" 
          onClick={handleSave}
          disabled={loading}
          className="h-8 w-8 p-0 text-green-600 hover:text-green-700 hover:bg-green-50"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
        </Button>
        <Button 
          size="sm" 
          variant="ghost" 
          onClick={handleCancel}
          disabled={loading}
          className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
        >
          <X className="w-4 h-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 group">
      {currentValue !== null && currentValue !== undefined ? (
        <span className="text-2xl font-bold">{currentValue}%</span>
      ) : (
        <span className="text-lg text-muted-foreground italic">{placeholderText}</span>
      )}
      <Button 
        size="sm" 
        variant="ghost" 
        onClick={handleEdit}
        className={cn(
          "h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity",
          currentValue === null && "opacity-60 group-hover:opacity-100"
        )}
      >
        <Edit2 className="w-3.5 h-3.5" />
      </Button>
    </div>
  );
};

export default EditablePercentageField;