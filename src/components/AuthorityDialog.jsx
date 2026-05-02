import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from "@/components/ui/use-toast";
import { format } from 'date-fns';
import { cs } from 'date-fns/locale';
import {
  Calendar as CalendarIcon,
  Clock,
  Briefcase,
  Check,
  ChevronsUpDown,
  HardHat,
  Loader2,
  X
} from 'lucide-react';
import { cn } from "@/lib/utils";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const AttendanceDialog = ({ isOpen, onClose, onSave, record, isAdmin, memberId, initialDate }) => {
  const { toast } = useToast();

  // -- State Management --
  const [workType, setWorkType] = useState('project'); // 'project' or 'realization'

  // Changed to handle arrays for multiple selection
  const [formData, setFormData] = useState({
    member_id: '',
    project_ids: [],     // Array of project IDs
    realizace_ids: [],   // Array of realization IDs
    date: new Date(),
    hours: '', // bulk hours helper (and single-record helper)
    project_hours: {}, // { [projectId]: hoursString }
    realizace_hours: {}, // { [realizaceId]: hoursString }
    description: '',
  });

  // Data Lists
  const [projects, setProjects] = useState([]);
  const [realizations, setRealizations] = useState([]);
  const [members, setMembers] = useState([]);

  // UI States
  const [errors, setErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loadingData, setLoadingData] = useState(false);

  // Popover Open States
  const [openProject, setOpenProject] = useState(false);
  const [openRealization, setOpenRealization] = useState(false);
  const [openMember, setOpenMember] = useState(false);
  const [openDate, setOpenDate] = useState(false);

  // -- Data Fetching --
  useEffect(() => {
    if (!isOpen) return;

    const loadData = async () => {
      setLoadingData(true);
      try {
        // 1. Fetch Members (only if Admin)
        if (isAdmin) {
          const { data: membersData, error: memberError } = await supabase
            .from('members')
            .select('id, name')
            .order('name');
          if (memberError) throw memberError;
          setMembers(membersData || []);
        }

        // 2. Fetch Projects
        let projectsData = [];
        if (isAdmin) {
          const { data, error } = await supabase
            .from('projects')
            .select('id, name, code')
            .neq('status', 'closed')
            .order('name');
          if (error) throw error;
          projectsData = data || [];
        } else {
          const targetMemberId = memberId;
          if (targetMemberId) {
            const { data, error } = await supabase
              .from('project_members')
              .select('projects(id, name, code)')
              .eq('member_id', targetMemberId);

            if (error) throw error;
            projectsData = data.map(pm => pm.projects).filter(Boolean);
          }
        }
        const uniqueProjects = Array.from(new Map(projectsData.map(p => [p.id, p])).values());
        setProjects(uniqueProjects.sort((a, b) => (a.name || '').localeCompare(b.name || '')));

        // 3. Fetch Realizations
        const { data: realData, error: realError } = await supabase
          .from('realizations')
          .select('id, name, status')
          .neq('status', 'Dokončeno')
          .order('name');

        if (realError) throw realError;
        setRealizations(realData || []);

      } catch (error) {
        console.error("Error loading dialog data:", error);
        toast({
          title: "Chyba načítání dat",
          description: "Nepodařilo se načíst seznamy projektů nebo realizací.",
          variant: "destructive"
        });
      } finally {
        setLoadingData(false);
      }
    };

    loadData();
    setErrors({});

    // Initialize Form Data
    if (record) {
      setWorkType(record.realizace_id ? 'realization' : 'project');
      setFormData({
        member_id: record.member_id || '',
        project_ids: record.project_id ? [record.project_id] : [],
        realizace_ids: record.realizace_id ? [record.realizace_id] : [],
        date: record.date ? new Date(record.date) : new Date(),
        hours: record.hours || '',
        project_hours: record.project_id ? { [record.project_id]: String(record.hours ?? '') } : {},
        realizace_hours: record.realizace_id ? { [record.realizace_id]: String(record.hours ?? '') } : {},
        description: record.description || '',
      });
    } else {
      setWorkType('project');
      setFormData({
        member_id: isAdmin ? '' : memberId,
        project_ids: [],
        realizace_ids: [],
        date: initialDate ? new Date(initialDate) : new Date(),
        hours: '',
        project_hours: {},
        realizace_hours: {},
        description: '',
      });
    }
  }, [isOpen, record, isAdmin, memberId, toast, initialDate]);

  // -- Validation --
  const validate = () => {
    const newErrors = {};

    if (workType === 'project' && formData.project_ids.length === 0) {
      newErrors.item_id = 'Vyberte alespoň jeden projekt';
    }
    if (workType === 'realization' && formData.realizace_ids.length === 0) {
      newErrors.item_id = 'Vyberte alespoň jednu realizaci';
    }

    if (!formData.date) newErrors.date = 'Vyberte datum';

    if (isAdmin && !formData.member_id) {
      newErrors.member_id = 'Vyberte pracovníka';
    }

    const selectedIds = workType === 'project' ? formData.project_ids : formData.realizace_ids;
    const hoursMap = workType === 'project' ? formData.project_hours : formData.realizace_hours;
    let total = 0;

    for (const id of selectedIds) {
      const raw = hoursMap?.[id];
      const h = parseFloat(raw);
      if (!raw || isNaN(h) || h <= 0) {
        newErrors.hours = 'Zadejte počet hodin (více než 0) u všech vybraných položek';
        break;
      }
      if (h > 24) {
        newErrors.hours = 'Nelze zadat více než 24h u jedné položky';
        break;
      }
      total += h;
    }

    if (!newErrors.hours && total > 24) {
      newErrors.hours = 'Součet hodin za den nesmí být vyšší než 24h';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // -- Submission --
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;

    setIsSubmitting(true);
    try {
      // If editing a single record (record prop exists), just update that one
      if (record) {
        const selectedProjectId = formData.project_ids[0];
        const selectedRealizaceId = formData.realizace_ids[0];
        const singleHours =
          workType === 'project'
            ? ((formData.project_hours?.[selectedProjectId]) ?? formData.hours)
            : ((formData.realizace_hours?.[selectedRealizaceId]) ?? formData.hours);

        const payload = {
          member_id: formData.member_id,
          date: format(formData.date, 'yyyy-MM-dd'),
          project_id: workType === 'project' ? selectedProjectId : null,
          realizace_id: workType === 'realization' ? selectedRealizaceId : null,
          hours: singleHours,
          description: formData.description
        };
        await onSave(payload);
      }
      // If creating new, we might need to create multiple records if multiple items selected
      else {
        const items = workType === 'project' ? formData.project_ids : formData.realizace_ids;
        const hoursMap = workType === 'project' ? formData.project_hours : formData.realizace_hours;
        const payloads = items.map(itemId => ({
          member_id: formData.member_id,
          date: format(formData.date, 'yyyy-MM-dd'),
          project_id: workType === 'project' ? itemId : null,
          realizace_id: workType === 'realization' ? itemId : null,
          hours: (hoursMap?.[itemId]) ?? formData.hours,
          description: formData.description
        }));

        await onSave(payloads);
      }

      onClose();
    } catch (error) {
      console.error("Submit error:", error);
      toast({ title: 'Chyba', description: 'Nepodařilo se uložit záznam.', variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
    }
  };

  // -- Handlers for Multi-select --
  const toggleProject = (projectId) => {
    setFormData(prev => {
      const currentIds = prev.project_ids;
      const currentHours = { ...(prev.project_hours || {}) };

      // Editing => single-select behavior
      if (record) {
        if (!currentHours[projectId]) currentHours[projectId] = prev.hours || '';
        return { ...prev, project_ids: [projectId], project_hours: currentHours, realizace_ids: [], realizace_hours: {} };
      }

      if (currentIds.includes(projectId)) {
        const nextIds = currentIds.filter(id => id !== projectId);
        delete currentHours[projectId];
        return { ...prev, project_ids: nextIds, project_hours: currentHours };
      }

      currentHours[projectId] = (currentHours[projectId]) ?? (prev.hours || '');
      return { ...prev, project_ids: [...currentIds, projectId], project_hours: currentHours };
    });
  };

  const toggleRealization = (realizId) => {
    setFormData(prev => {
      const currentIds = prev.realizace_ids;
      const currentHours = { ...(prev.realizace_hours || {}) };

      // Editing => single-select behavior
      if (record) {
        if (!currentHours[realizId]) currentHours[realizId] = prev.hours || '';
        return { ...prev, realizace_ids: [realizId], realizace_hours: currentHours, project_ids: [], project_hours: {} };
      }

      if (currentIds.includes(realizId)) {
        const nextIds = currentIds.filter(id => id !== realizId);
        delete currentHours[realizId];
        return { ...prev, realizace_ids: nextIds, realizace_hours: currentHours };
      }

      currentHours[realizId] = (currentHours[realizId]) ?? (prev.hours || '');
      return { ...prev, realizace_ids: [...currentIds, realizId], realizace_hours: currentHours };
    });
  };

  const removeProject = (projectId) => {
    setFormData(prev => {
      const nextHours = { ...(prev.project_hours || {}) };
      delete nextHours[projectId];
      return { ...prev, project_ids: prev.project_ids.filter(id => id !== projectId), project_hours: nextHours };
    });
  };

  const removeRealization = (realizId) => {
    setFormData(prev => {
      const nextHours = { ...(prev.realizace_hours || {}) };
      delete nextHours[realizId];
      return { ...prev, realizace_ids: prev.realizace_ids.filter(id => id !== realizId), realizace_hours: nextHours };
    });
  };

  const applyHoursToAllSelected = () => {
    setFormData(prev => {
      const bulk = prev.hours;
      if (!bulk) return prev;
      if (workType === 'project') {
        const next = { ...(prev.project_hours || {}) };
        prev.project_ids.forEach(id => { next[id] = bulk; });
        return { ...prev, project_hours: next };
      }
      const next = { ...(prev.realizace_hours || {}) };
      prev.realizace_ids.forEach(id => { next[id] = bulk; });
      return { ...prev, realizace_hours: next };
    });
  };

  const selectedTotalHours = React.useMemo(() => {
    const selectedIds = workType === 'project' ? formData.project_ids : formData.realizace_ids;
    const hoursMap = workType === 'project' ? formData.project_hours : formData.realizace_hours;
    return selectedIds.reduce((sum, id) => sum + (parseFloat(hoursMap?.[id]) || 0), 0);
  }, [formData.project_ids, formData.realizace_ids, formData.project_hours, formData.realizace_hours, workType]);

  const selectedSingleHours = React.useMemo(() => {
    const projectId = formData.project_ids?.[0];
    const realizaceId = formData.realizace_ids?.[0];
    if (workType === 'project') return projectId ? ((formData.project_hours?.[projectId]) ?? '') : '';
    return realizaceId ? ((formData.realizace_hours?.[realizaceId]) ?? '') : '';
  }, [formData.project_ids, formData.realizace_ids, formData.project_hours, formData.realizace_hours, workType]);


  // -- Render Helpers --
  const selectedMember = members.find(m => m.id === formData.member_id);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px] overflow-visible">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {record ? <Clock className="w-5 h-5 text-blue-600" /> : <Clock className="w-5 h-5 text-green-600" />}
            {record ? 'Upravit záznam' : 'Nový záznam docházky'}
          </DialogTitle>
        </DialogHeader>

        {loadingData ? (
          <div className="py-12 flex flex-col items-center justify-center text-muted-foreground">
            <Loader2 className="w-8 h-8 animate-spin mb-2" />
            <p>Načítám seznamy...</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5 py-2">

            <Tabs value={workType} onValueChange={(val) => {
              setWorkType(val);
              setErrors({});
              // Clear selection when switching tabs if creating new
              if (!record) {
                setFormData(prev => ({ ...prev, project_ids: [], realizace_ids: [], project_hours: {}, realizace_hours: {} }));
              }
            }} className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="project" className="flex items-center gap-2">
                  <Briefcase className="w-4 h-4" /> Projekt
                </TabsTrigger>
                <TabsTrigger value="realization" className="flex items-center gap-2">
                  <HardHat className="w-4 h-4" /> Realizace
                </TabsTrigger>
              </TabsList>
            </Tabs>

            {isAdmin && (
              <div className="space-y-2">
                <Label className={cn(errors.member_id && "text-destructive")}>
                  Pracovník {errors.member_id && "*"}
                </Label>
                <Popover open={openMember} onOpenChange={setOpenMember}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" role="combobox" aria-expanded={openMember} className="w-full justify-between">
                      {selectedMember ? selectedMember.name : "Vyberte pracovníka..."}
                      <ChevronsUpDown className="ml-2 h-4 w-4 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[400px] p-0">
                    <Command>
                      <CommandInput placeholder="Hledat..." />
                      <CommandList>
                        <CommandEmpty>Nenalezeno.</CommandEmpty>
                        <CommandGroup>
                          {members.map((m) => (
                            <CommandItem
                              key={m.id}
                              value={m.name}
                              onSelect={() => {
                                setFormData(prev => ({ ...prev, member_id: m.id }));
                                setOpenMember(false);
                              }}
                            >
                              <Check className={cn("mr-2 h-4 w-4", formData.member_id === m.id ? "opacity-100" : "opacity-0")} />
                              {m.name}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
            )}

            <div className="space-y-3">
              <Label className={cn(errors.item_id && "text-destructive")}>
                {workType === 'project' ? 'Projekty' : 'Realizace'} {errors.item_id && "*"}
              </Label>

              {/* Selected Items Tags */}
              <div className="flex flex-wrap gap-2 mb-2 min-h-[24px]">
                {workType === 'project' ? (
                  formData.project_ids.length > 0 ? (
                    formData.project_ids.map(id => {
                      const p = projects.find(proj => proj.id === id);
                      if (!p) return null;
                      return (
                        <div key={id} className="flex items-center gap-2 rounded-full bg-secondary px-2 py-1">
                          <span className="max-w-[210px] truncate text-sm">{p.code} - {p.name}</span>
                          <div className="relative w-[92px]">
                            <Input
                              type="number"
                              step="0.5"
                              min="0"
                              max="24"
                              value={(formData.project_hours?.[id]) ?? ''}
                              onChange={(e) => setFormData(prev => ({
                                ...prev,
                                project_hours: { ...(prev.project_hours || {}), [id]: e.target.value }
                              }))}
                              className="h-7 pr-7 text-right font-mono bg-white"
                              placeholder="0.0"
                            />
                            <span className="absolute right-2 top-1.5 text-[10px] text-muted-foreground">hod</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeProject(id)}
                            className="hover:bg-slate-200 rounded-full p-0.5 transition-colors"
                            aria-label="Odebrat projekt"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      );
                    })
                  ) : <span className="text-sm text-muted-foreground italic">Žádné vybrané projekty</span>
                ) : (
                  formData.realizace_ids.length > 0 ? (
                    formData.realizace_ids.map(id => {
                      const r = realizations.find(real => real.id === id);
                      if (!r) return null;
                      return (
                        <div key={id} className="flex items-center gap-2 rounded-full bg-secondary px-2 py-1">
                          <span className="max-w-[210px] truncate text-sm">{r.name}</span>
                          <div className="relative w-[92px]">
                            <Input
                              type="number"
                              step="0.5"
                              min="0"
                              max="24"
                              value={(formData.realizace_hours?.[id]) ?? ''}
                              onChange={(e) => setFormData(prev => ({
                                ...prev,
                                realizace_hours: { ...(prev.realizace_hours || {}), [id]: e.target.value }
                              }))}
                              className="h-7 pr-7 text-right font-mono bg-white"
                              placeholder="0.0"
                            />
                            <span className="absolute right-2 top-1.5 text-[10px] text-muted-foreground">hod</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeRealization(id)}
                            className="hover:bg-slate-200 rounded-full p-0.5 transition-colors"
                            aria-label="Odebrat realizaci"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      );
                    })
                  ) : <span className="text-sm text-muted-foreground italic">Žádné vybrané realizace</span>
                )}
              </div>

              <Popover
                open={workType === 'project' ? openProject : openRealization}
                onOpenChange={workType === 'project' ? setOpenProject : setOpenRealization}
              >
                <PopoverTrigger asChild>
                  <Button variant="outline" role="combobox" className="w-full justify-between text-muted-foreground font-normal">
                    {workType === 'project' ? "+ Vybrat projekty..." : "+ Vybrat realizace..."}
                    <ChevronsUpDown className="ml-2 h-4 w-4 opacity-50 shrink-0" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[450px] p-0" align="start">
                  <Command>
                    <CommandInput placeholder={workType === 'project' ? "Hledat projekt..." : "Hledat realizaci..."} />
                    <CommandList className="max-h-[300px] overflow-y-auto overscroll-contain">
                      <CommandEmpty>Nenalezeno.</CommandEmpty>
                      <CommandGroup>
                        {workType === 'project' ? (
                          projects.map((p) => (
                            <CommandItem
                              key={p.id}
                              value={`${p.code} ${p.name}`}
                              onSelect={() => {
                                toggleProject(p.id);
                                if (record) setOpenProject(false);
                              }}
                            >
                              <div className={cn(
                                "mr-2 flex h-4 w-4 items-center justify-center rounded-sm border border-primary",
                                formData.project_ids.includes(p.id) ? "bg-primary text-primary-foreground" : "opacity-50 [&_svg]:invisible"
                              )}>
                                <Check className={cn("h-4 w-4")} />
                              </div>
                              <div className="flex flex-col">
                                <span className="font-medium">{p.name}</span>
                                {p.code && <span className="text-xs text-muted-foreground">{p.code}</span>}
                              </div>
                            </CommandItem>
                          ))
                        ) : (
                          realizations.map((r) => (
                            <CommandItem
                              key={r.id}
                              value={r.name}
                              onSelect={() => {
                                toggleRealization(r.id);
                                if (record) setOpenRealization(false);
                              }}
                            >
                              <div className={cn(
                                "mr-2 flex h-4 w-4 items-center justify-center rounded-sm border border-primary",
                                formData.realizace_ids.includes(r.id) ? "bg-primary text-primary-foreground" : "opacity-50 [&_svg]:invisible"
                              )}>
                                <Check className={cn("h-4 w-4")} />
                              </div>
                              <span>{r.name}</span>
                            </CommandItem>
                          ))
                        )}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              {errors.item_id && <p className="text-sm text-destructive mt-1">{errors.item_id}</p>}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className={cn(errors.date && "text-destructive")}>Datum</Label>
                <Popover open={openDate} onOpenChange={setOpenDate}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !formData.date && "text-muted-foreground")}>
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {formData.date ? format(formData.date, 'd. M. yyyy', { locale: cs }) : "Vybrat..."}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={formData.date}
                      onSelect={(date) => {
                        if (date) {
                          setFormData(prev => ({ ...prev, date }));
                          setOpenDate(false);
                        }
                      }}
                      locale={cs}
                      initialFocus={false}
                    />
                  </PopoverContent>
                </Popover>
              </div>

              {record ? (
                <div className="space-y-2">
                  <Label className={cn(errors.hours && "text-destructive")}>Hodiny</Label>
                  <div className="relative">
                    <Input
                      type="number"
                      step="0.5"
                      min="0"
                      max="24"
                      value={selectedSingleHours}
                      onChange={(e) => {
                        const value = e.target.value;
                        setFormData((prev) => {
                          if (workType === 'project') {
                            const projectId = prev.project_ids?.[0];
                            if (!projectId) return { ...prev, hours: value };
                            return {
                              ...prev,
                              hours: value,
                              project_hours: { ...(prev.project_hours || {}), [projectId]: value },
                            };
                          }
                          const realizaceId = prev.realizace_ids?.[0];
                          if (!realizaceId) return { ...prev, hours: value };
                          return {
                            ...prev,
                            hours: value,
                            realizace_hours: { ...(prev.realizace_hours || {}), [realizaceId]: value },
                          };
                        });
                      }}
                      className="pr-8 text-right font-mono"
                      placeholder="8.0"
                    />
                    <span className="absolute right-3 top-2.5 text-xs text-muted-foreground">hod</span>
                  </div>
                  {errors.hours && <p className="text-sm text-destructive mt-1">{errors.hours}</p>}
                </div>
              ) : (
                <div className="space-y-2">
                  <Label className={cn(errors.hours && "text-destructive")}>
                    Hodiny (nastavit všem) {errors.hours && "*"}
                  </Label>
                  <div className="relative">
                    <Input
                      type="number"
                      step="0.5"
                      min="0"
                      max="24"
                      value={formData.hours}
                      onChange={(e) => setFormData({ ...formData, hours: e.target.value })}
                      className="pr-8 text-right font-mono"
                      placeholder="8.0"
                    />
                    <span className="absolute right-3 top-2.5 text-xs text-muted-foreground">hod</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <Button type="button" variant="outline" size="sm" onClick={applyHoursToAllSelected} disabled={!formData.hours}>
                      Použít pro všechny
                    </Button>
                    <p className="text-[10px] text-muted-foreground text-right">
                      Celkem vybráno: {selectedTotalHours.toFixed(1)}h
                    </p>
                  </div>
                  {errors.hours && <p className="text-sm text-destructive mt-1">{errors.hours}</p>}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label>Popis činnosti</Label>
              <Textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Co se dělalo..."
                className="resize-none h-[100px]"
              />
            </div>

            <DialogFooter className="pt-4 gap-2 sm:gap-0">
              <Button type="button" variant="ghost" onClick={onClose} disabled={isSubmitting}>
                Zrušit
              </Button>
              <Button type="submit" disabled={isSubmitting} className={cn(record ? "bg-blue-600" : "bg-green-600")}>
                {isSubmitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {record ? 'Uložit změny' : `Uložit záznamy (${workType === 'project' ? formData.project_ids.length : formData.realizace_ids.length})`}
              </Button>
            </DialogFooter>

          </form>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default AttendanceDialog;