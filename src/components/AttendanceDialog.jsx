import React, { useState, useEffect, useMemo } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { FormDialogBody, FormDialogContent, FormDialogFooter, FormDialogHeader } from '@/components/ui/form-dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from "@/components/ui/use-toast";
import { format } from 'date-fns';
import { Clock, Loader2, Briefcase, HardHat, Plus, X, ArrowDownToLine, Trash2, AlertCircle } from 'lucide-react';
import { cn } from "@/lib/utils";
import { useAuth } from '@/contexts/SupabaseAuthContext';

// Zod
import { z } from 'zod';
import { AttendanceSchema } from '@/lib/validationSchemas';
import { parseApiError } from '@/lib/apiValidation';

const AttendanceDialog = ({ isOpen, onClose, onSave, record, isAdmin, memberId, initialDate }) => {
  const { toast } = useToast();
  const { userRole } = useAuth();
  
  // -- Global State --
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  
  // -- Data Source State --
  const [projects, setProjects] = useState([]);
  const [realizations, setRealizations] = useState([]);
  const [members, setMembers] = useState([]);

  // -- Form State --
  const [commonData, setCommonData] = useState({
    member_id: '',
    date: '',
    description: ''
  });

  // Mode: 'single' (edit existing) or 'batch' (create new)
  const isEditMode = !!record;

  // -- Batch Mode State --
  const [activeType, setActiveType] = useState('project'); 
  const [batchItems, setBatchItems] = useState([]); 
  const [globalHoursInput, setGlobalHoursInput] = useState(''); 

  // -- Single Mode State (Edit) --
  const [singleItem, setSingleItem] = useState({
    type: 'project',
    item_id: '',
    hours: ''
  });

  // -- Load Data --
  useEffect(() => {
    if (!isOpen) return;

    const loadData = async () => {
      setLoading(true);
      try {
        if (isAdmin) {
          const { data } = await supabase.from('members').select('id, name').order('name');
          setMembers(data || []);
        }

        const { data: projData } = await supabase
          .from('projects')
          .select('id, name, code')
          .neq('status', 'closed')
          .order('name');
        setProjects(projData || []);

        let realQuery = supabase
          .from('realizations')
          .select('id, name')
          .neq('status', 'Dokončeno')
          .order('name');
        
        if (userRole === 'user' && memberId) {
            realQuery = realQuery.contains('team_members', [memberId]);
        }

        const { data: realData } = await realQuery;
        setRealizations(realData || []);

      } catch (err) {
        toast({ title: "Chyba", description: "Nepodařilo se načíst seznamy.", variant: "destructive" });
      } finally {
        setLoading(false);
      }
    };

    loadData();
    setError('');
    setBatchItems([]);
    setGlobalHoursInput('');

    if (record) {
      const isRealization = !!record.realizace_id && !record.project_id;
      setCommonData({
        member_id: record.member_id,
        date: record.date ? format(new Date(record.date), 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd'),
        description: record.description || ''
      });
      setSingleItem({
        type: isRealization ? 'realization' : 'project',
        item_id: isRealization ? record.realizace_id : (record.project_id || ''),
        hours: record.hours?.toString() || ''
      });
    } else {
      setCommonData({
        member_id: memberId || '',
        date: initialDate ? format(new Date(initialDate), 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd'),
        description: ''
      });
    }

  }, [isOpen, record, isAdmin, memberId, initialDate, toast, userRole]);

  const handleAddItem = (itemId) => {
    let item;
    if (activeType === 'project') {
      const p = projects.find(p => p.id === itemId);
      item = { id: itemId, type: 'project', name: p.name, code: p.code, hours: '' };
    } else {
      const r = realizations.find(r => r.id === itemId);
      item = { id: itemId, type: 'realization', name: r.name, code: 'REALIZACE', hours: '' };
    }

    if (batchItems.some(i => i.id === itemId && i.type === activeType)) {
      toast({ title: "Položka již v seznamu", variant: "secondary" });
      return;
    }

    setBatchItems(prev => [...prev, item]);
  };

  const handleRemoveItem = (index) => {
    setBatchItems(prev => prev.filter((_, i) => i !== index));
  };

  const handleItemHoursChange = (index, value) => {
    setBatchItems(prev => {
      const newItems = [...prev];
      newItems[index].hours = value;
      return newItems;
    });
  };

  const handleSetAllHours = () => {
    if (!globalHoursInput) return;
    setBatchItems(prev => prev.map(item => ({ ...item, hours: globalHoursInput })));
  };

  const getExistingDailyHours = async (targetMemberId, targetDate) => {
    let query = supabase
      .from('attendance')
      .select('id, hours')
      .eq('member_id', targetMemberId)
      .eq('date', targetDate);

    if (isEditMode && record?.id) {
      query = query.neq('id', record.id);
    }

    const { data, error: attendanceError } = await query;
    if (attendanceError) throw attendanceError;

    return (data || []).reduce((sum, item) => {
      const hours = parseFloat(String(item.hours).replace(',', '.'));
      return sum + (Number.isFinite(hours) ? hours : 0);
    }, 0);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    
    // Validate payloads
    const itemsToValidate = isEditMode ? [{ 
        hours: singleItem.hours,
        project_id: singleItem.type === 'project' ? singleItem.item_id : null,
        realizace_id: singleItem.type === 'realization' ? singleItem.item_id : null
    }] : batchItems.map(item => ({
        hours: item.hours,
        project_id: item.type === 'project' ? item.id : null,
        realizace_id: item.type === 'realization' ? item.id : null
    }));

    if (itemsToValidate.length === 0) {
        setError("Musíte přidat alespoň jednu položku.");
        return;
    }

    try {
        // Validate each item with Zod
        let totalHours = 0;
        for (const item of itemsToValidate) {
            const payload = {
                member_id: isAdmin ? commonData.member_id : memberId,
                date: commonData.date,
                description: commonData.description,
                hours: parseFloat(String(item.hours).replace(',', '.')),
                project_id: item.project_id || null,
                realizace_id: item.realizace_id || null
            };
            
            AttendanceSchema.parse(payload);
            totalHours += payload.hours;
        }

        if (totalHours > 24) {
            setError(`Celkový součet hodin (${totalHours}) nesmí překročit 24h za den.`);
            return;
        }

        setSubmitting(true);
        const targetMemberId = isAdmin ? commonData.member_id : memberId;
        const existingHours = await getExistingDailyHours(targetMemberId, commonData.date);
        const dailyTotal = existingHours + totalHours;

        if (dailyTotal > 24) {
            setError(`Celkový součet hodin za den by byl ${dailyTotal.toLocaleString('cs-CZ')} h. Již uložené záznamy: ${existingHours.toLocaleString('cs-CZ')} h, nově zadáváte: ${totalHours.toLocaleString('cs-CZ')} h. Limit je 24 h.`);
            return;
        }

        if (isEditMode) {
            const payload = {
                member_id: isAdmin ? commonData.member_id : memberId,
                date: commonData.date,
                description: commonData.description,
                hours: parseFloat(String(singleItem.hours).replace(',', '.')),
                project_id: singleItem.type === 'project' ? singleItem.item_id : null,
                realizace_id: singleItem.type === 'realization' ? singleItem.item_id : null
            };
            await onSave(payload);
        } else {
             const payloads = itemsToValidate.map(item => ({
                member_id: isAdmin ? commonData.member_id : memberId,
                date: commonData.date,
                description: commonData.description,
                hours: parseFloat(String(item.hours).replace(',', '.')),
                project_id: item.project_id || null,
                realizace_id: item.realizace_id || null
            }));
            await onSave(payloads);
        }
    } catch (err) {
        if (err instanceof z.ZodError) {
             setError(err.errors[0].message);
        } else {
            console.error(err);
            const msg = parseApiError(err);
            setError(msg || "Ukládání se nezdařilo.");
        }
    } finally {
        setSubmitting(false);
    }
  };

  const totalBatchHours = useMemo(() => {
    return batchItems.reduce((sum, item) => {
        const h = parseFloat(item.hours.replace(',', '.') || 0);
        return sum + (isNaN(h) ? 0 : h);
    }, 0);
  }, [batchItems]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <FormDialogContent size="xl">
        <div className="hidden">
          <div className="flex items-center gap-2">
            {isEditMode ? <Clock className="w-5 h-5 text-blue-600" /> : <Clock className="w-5 h-5 text-green-600" />}
            {isEditMode ? 'Upravit záznam' : 'Zadat docházku'}
          </div>
        </div>
        <FormDialogHeader
          icon={Clock}
          title={isEditMode ? 'Upravit záznam' : 'Zadat docházku'}
          description="Zadejte datum, pracovníka a odpracované hodiny."
        />

        {loading ? (
          <div className="py-8 flex justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <FormDialogBody className="space-y-5">
            
            {error && (
              <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-md font-medium flex items-center gap-2">
                 <AlertCircle className="w-4 h-4"/> {error}
              </div>
            )}

            <div className="rounded-lg border border-blue-100 bg-blue-50/70 p-4 text-sm text-blue-900">
              <div className="font-semibold">Kontrola zadání</div>
              <p className="mt-1 leading-5">Denní limit je 24 hodin. Při hromadném zadání můžete vybrat více projektů nebo realizací a každé položce nastavit vlastní počet hodin.</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
               <div className="space-y-1.5">
                <Label>Datum</Label>
                <Input 
                    type="date" 
                    value={commonData.date} 
                    onChange={(e) => setCommonData(prev => ({ ...prev, date: e.target.value }))}
                />
               </div>
               {isAdmin && (
                <div className="space-y-1.5">
                    <Label>Pracovník</Label>
                    <Select 
                        value={commonData.member_id} 
                        onValueChange={(val) => setCommonData(prev => ({ ...prev, member_id: val }))}
                        disabled={isEditMode}
                    >
                        <SelectTrigger>
                            <SelectValue placeholder="Vyberte pracovníka" />
                        </SelectTrigger>
                        <SelectContent>
                            {members.map(m => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </div>
               )}
            </div>

            {isEditMode ? (
                <div className="space-y-4 border rounded-lg p-4 bg-slate-50">
                    <div className="space-y-1.5">
                         <Label>Typ činnosti</Label>
                         <div className="flex gap-2">
                            <Button
                                type="button"
                                variant={singleItem.type === 'project' ? 'default' : 'outline'}
                                size="sm"
                                onClick={() => setSingleItem(prev => ({ ...prev, type: 'project', item_id: '' }))}
                                className="flex-1"
                            >
                                <Briefcase className="w-4 h-4 mr-2"/> Projekt
                            </Button>
                            <Button
                                type="button"
                                variant={singleItem.type === 'realization' ? 'default' : 'outline'}
                                size="sm"
                                onClick={() => setSingleItem(prev => ({ ...prev, type: 'realization', item_id: '' }))}
                                className="flex-1"
                            >
                                <HardHat className="w-4 h-4 mr-2"/> Realizace
                            </Button>
                         </div>
                    </div>
                    
                    <div className="space-y-1.5">
                        <Label>{singleItem.type === 'project' ? 'Vybrat projekt' : 'Vybrat realizaci'}</Label>
                        <Select 
                            value={singleItem.item_id} 
                            onValueChange={(val) => setSingleItem(prev => ({ ...prev, item_id: val }))}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="Vyberte položku..." />
                            </SelectTrigger>
                            <SelectContent className="max-h-[200px]">
                                {singleItem.type === 'project' 
                                    ? projects.map(p => <SelectItem key={p.id} value={p.id}>{p.code} - {p.name}</SelectItem>)
                                    : realizations.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)
                                }
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-1.5">
                        <Label>Počet hodin</Label>
                        <Input
                            type="number"
                            step="0.5"
                            value={singleItem.hours}
                            onChange={(e) => setSingleItem(prev => ({ ...prev, hours: e.target.value }))}
                        />
                    </div>
                </div>
            ) : (
                <div className="space-y-4">
                    <div className="bg-slate-50 p-3 rounded-lg border space-y-3">
                         <div className="flex items-center justify-between">
                            <Label className="text-slate-600">Přidat položky do výkazu</Label>
                            <div className="flex bg-white rounded-md border p-0.5">
                                <button
                                    type="button"
                                    onClick={() => setActiveType('project')}
                                    className={cn("px-3 py-1 text-xs rounded-sm transition-colors flex items-center gap-1", activeType === 'project' ? "bg-blue-100 text-blue-700 font-medium" : "text-muted-foreground hover:bg-slate-50")}
                                >
                                    <Briefcase className="w-3 h-3"/> Projekt
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setActiveType('realization')}
                                    className={cn("px-3 py-1 text-xs rounded-sm transition-colors flex items-center gap-1", activeType === 'realization' ? "bg-blue-100 text-blue-700 font-medium" : "text-muted-foreground hover:bg-slate-50")}
                                >
                                    <HardHat className="w-3 h-3"/> Realizace
                                </button>
                            </div>
                         </div>
                         
                         <Select 
                            value="" 
                            onValueChange={handleAddItem}
                         >
                            <SelectTrigger className="bg-white">
                                <SelectValue placeholder={activeType === 'project' ? "+ Přidat projekt..." : "+ Přidat realizaci..."} />
                            </SelectTrigger>
                            <SelectContent className="max-h-[300px]">
                                {activeType === 'project' 
                                    ? projects.map(p => (
                                        <SelectItem key={p.id} value={p.id} disabled={batchItems.some(i => i.id === p.id && i.type === 'project')}>
                                            <div className="flex flex-col items-start">
                                                <span className="font-medium">{p.code}</span>
                                                <span className="text-xs text-muted-foreground">{p.name}</span>
                                            </div>
                                        </SelectItem>
                                    ))
                                    : realizations.map(r => (
                                        <SelectItem key={r.id} value={r.id} disabled={batchItems.some(i => i.id === r.id && i.type === 'realization')}>
                                            {r.name}
                                        </SelectItem>
                                    ))
                                }
                            </SelectContent>
                        </Select>
                    </div>

                    {batchItems.length > 1 && (
                        <div className="flex items-end gap-2 px-1">
                            <div className="flex-1 space-y-1">
                                <Label className="text-xs text-muted-foreground">Nastavit všem stejně:</Label>
                                <Input 
                                    placeholder="např. 8" 
                                    className="h-8" 
                                    value={globalHoursInput}
                                    onChange={e => setGlobalHoursInput(e.target.value)}
                                    type="number"
                                />
                            </div>
                            <Button type="button" size="sm" variant="secondary" onClick={handleSetAllHours} className="h-8">
                                <ArrowDownToLine className="w-3 h-3 mr-1"/> Použít
                            </Button>
                        </div>
                    )}

                    <div className="space-y-2">
                        {batchItems.length === 0 ? (
                            <div className="text-center py-8 border-2 border-dashed rounded-lg text-muted-foreground text-sm">
                                Zatím žádné vybrané projekty.
                                <br/>Vyberte položku výše pro přidání.
                            </div>
                        ) : (
                            batchItems.map((item, idx) => (
                                <div key={`${item.type}-${item.id}`} className="flex items-center gap-3 bg-white p-2 rounded-md border shadow-sm group">
                                    <div className="shrink-0">
                                        {item.type === 'project' 
                                            ? <div className="w-8 h-8 rounded bg-blue-50 flex items-center justify-center text-blue-600"><Briefcase className="w-4 h-4"/></div>
                                            : <div className="w-8 h-8 rounded bg-orange-50 flex items-center justify-center text-orange-600"><HardHat className="w-4 h-4"/></div>
                                        }
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="font-medium text-sm truncate">{item.type === 'project' ? item.code : 'Realizace'}</div>
                                        <div className="text-xs text-muted-foreground truncate">{item.name}</div>
                                    </div>
                                    <div className="w-20">
                                        <Input
                                            type="number"
                                            step="0.5"
                                            placeholder="Hod."
                                            value={item.hours}
                                            onChange={(e) => handleItemHoursChange(idx, e.target.value)}
                                            className="h-8 text-right pr-2"
                                        />
                                    </div>
                                    <Button 
                                        type="button" 
                                        variant="ghost" 
                                        size="icon" 
                                        className="h-8 w-8 text-slate-400 hover:text-red-500"
                                        onClick={() => handleRemoveItem(idx)}
                                    >
                                        <Trash2 className="w-4 h-4"/>
                                    </Button>
                                </div>
                            ))
                        )}
                    </div>
                    
                    {batchItems.length > 0 && (
                        <div className="flex justify-between items-center pt-2 border-t text-sm font-medium">
                            <span>Celkem hodin:</span>
                            <span className={cn("text-lg", totalBatchHours > 24 ? "text-red-600" : "text-blue-600")}>
                                {totalBatchHours.toFixed(1)} h
                            </span>
                        </div>
                    )}
                </div>
            )}

            <div className="space-y-1.5 pt-2">
              <Label>Popis činnosti <span className="text-muted-foreground font-normal text-xs">(společný pro všechny)</span></Label>
              <Textarea
                placeholder="Co se dělalo..."
                value={commonData.description}
                onChange={(e) => setCommonData(prev => ({ ...prev, description: e.target.value }))}
                className="resize-none min-h-[80px]"
              />
            </div>

          </FormDialogBody>
        )}

        <FormDialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
            Zrušit
            </Button>
            <Button 
                onClick={handleSubmit} 
                disabled={submitting || (!isEditMode && batchItems.length === 0)} 
                className={cn(isEditMode ? "bg-blue-600 hover:bg-blue-700" : "bg-green-600 hover:bg-green-700")}
            >
            {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {isEditMode ? 'Uložit změny' : `Uložit ${batchItems.length > 0 ? `(${batchItems.length})` : ''}`}
            </Button>
        </FormDialogFooter>
      </FormDialogContent>
    </Dialog>
  );
};

export default AttendanceDialog;
