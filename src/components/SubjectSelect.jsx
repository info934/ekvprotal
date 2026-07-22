import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Plus, AlertCircle, X } from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import SubjectDialog from '@/components/SubjectDialog';
import { Label } from '@/components/ui/label';
import CustomSelect from './CustomSelect';

const SubjectSelect = ({
  value,
  onChange,
  label,
  placeholder = 'Vybrat subjekt...',
  disabled = false,
  excludeIds = [],
  onCreated,
  initialSubject = null,
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
      let { data, error: subjectsError } = await supabase
        .from('subjects')
        .select('id, name, ico, address, subject_kind, birth_date')
        .order('name');

      if (subjectsError?.code === '42703' || subjectsError?.code === 'PGRST204') {
        const fallback = await supabase
          .from('subjects')
          .select('id, name, ico, address')
          .order('name');
        data = fallback.data;
        subjectsError = fallback.error;
      }

      if (subjectsError) throw subjectsError;

      const formattedItems = (data || []).map((item) => ({
        id: item.id,
        label: item.name,
        subject: item,
        description: item.ico
          ? `ICO: ${item.ico}`
          : (item.subject_kind === 'person' ? 'Fyzicka osoba' : (item.address || 'Subjekt')),
      }));

      setItems((current) => {
        const fallback = initialSubject?.id ? [{
          id: initialSubject.id,
          label: initialSubject.name || initialSubject.label || 'Vybraný subjekt',
          subject: initialSubject,
          description: initialSubject.ico ? `IČO: ${initialSubject.ico}` : (initialSubject.address || 'Subjekt'),
        }] : [];
        const merged = new Map([...fallback, ...current, ...formattedItems].map((item) => [item.id, item]));
        return Array.from(merged.values()).sort((a, b) => a.label.localeCompare(b.label, 'cs'));
      });
    } catch (err) {
      setError('Chyba nacitani');
      toast({
        title: 'Chyba nacitani',
        description: 'Nepodarilo se nacist seznam subjektu.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSubjects();
  }, []);

  useEffect(() => {
    if (!initialSubject?.id) return;
    setItems((current) => {
      if (current.some((item) => item.id === initialSubject.id)) return current;
      return [...current, {
        id: initialSubject.id,
        label: initialSubject.name || initialSubject.label || 'Vybraný subjekt',
        subject: initialSubject,
        description: initialSubject.ico ? `IČO: ${initialSubject.ico}` : (initialSubject.address || 'Subjekt'),
      }].sort((a, b) => a.label.localeCompare(b.label, 'cs'));
    });
  }, [initialSubject]);

  const handleSaveSubject = async (formData) => {
    try {
      const { data, error: insertError } = await supabase
        .from('subjects')
        .insert([formData])
        .select()
        .single();

      if (insertError) throw insertError;

      const formattedItem = {
        id: data.id,
        label: data.name,
        subject: data,
        description: data.ico ? `ICO: ${data.ico}` : 'Novy subjekt',
      };

      setItems((current) => [...current, formattedItem].sort((a, b) => a.label.localeCompare(b.label)));
      onChange(data.id, data);
      onCreated?.(data);
      setIsDialogOpen(false);
      return data;
    } catch (subjectError) {
      toast({
        title: 'Subjekt se nepodarilo vytvorit',
        description: subjectError.message,
        variant: 'destructive',
      });
      throw subjectError;
    }
  };

  const visibleItems = items.filter((item) => !excludeIds.includes(item.id));

  return (
    <div className="w-full space-y-2">
      {label && <Label className="font-medium text-slate-700">{label}</Label>}
      <div className="relative z-0 flex w-full items-center gap-2">
        <div className="min-w-0 flex-grow">
          <CustomSelect
            items={visibleItems}
            value={value}
            onChange={(nextValue) => {
              const selectedItem = items.find((item) => item.id === nextValue);
              onChange(nextValue, selectedItem?.subject || null);
            }}
            placeholder={placeholder}
            searchPlaceholder="Hledat subjekt, firmu nebo ICO..."
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
            onClick={() => onChange(null, null)}
            title="Zrusit vyber"
            className="h-10 w-10 shrink-0 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500"
          >
            <X className="h-4 w-4" />
          </Button>
        )}

        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => setIsDialogOpen(true)}
          title="Vytvorit novy subjekt"
          disabled={disabled}
          className="h-10 w-10 shrink-0"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {error && (
        <div className="mt-1 flex items-center gap-2 text-xs text-red-500">
          <AlertCircle className="h-3 w-3" />
          <span>{error}</span>
          <Button variant="link" size="sm" className="h-auto p-0 text-xs text-red-600 underline" onClick={fetchSubjects}>
            Zkusit znovu
          </Button>
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
