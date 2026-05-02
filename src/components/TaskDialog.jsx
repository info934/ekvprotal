import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { format } from 'date-fns';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Trash2, Plus, Edit2, Calendar, User, FileText, Target, AlertTriangle } from 'lucide-react';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle, AlertDialogFooter, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { motion, AnimatePresence } from 'framer-motion';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const TaskDialog = ({ isOpen, onClose, onSave, onDelete, task, projectId }) => {
  const { toast } = useToast();
  const { isAdmin } = useAuth();
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    start_date: '',
    end_date: '',
    member_id: '',
    status: 'Nové',
    project_id: projectId || '',
  });
  const [projectMembers, setProjectMembers] = useState([]);
  const [allProjects, setAllProjects] = useState([]);
  const [filteredProjects, setFilteredProjects] = useState([]);
  const [projectSearch, setProjectSearch] = useState('');
  const [taskStatuses, setTaskStatuses] = useState([]);

  useEffect(() => {
    const fetchAllProjects = async () => {
        if (!isOpen || projectId) return;
        const { data, error } = await supabase.from('projects').select('id, name, code').order('code');
        if (error) {
            toast({ title: 'Chyba při načítání projektů', variant: 'destructive' });
        } else {
            setAllProjects(data);
            setFilteredProjects(data);
        }
    };
    const fetchTaskStatuses = async () => {
        if (!isOpen) return;
        const { data, error } = await supabase.from('task_statuses').select('name').order('name');
        if (error) {
            toast({ title: 'Chyba při načítání stavů úkolů', variant: 'destructive' });
        } else {
            setTaskStatuses(data.map(s => s.name));
        }
    };
    fetchAllProjects();
    fetchTaskStatuses();
  }, [isOpen, projectId, toast]);

  useEffect(() => {
    if(projectSearch.trim() === '') {
        setFilteredProjects(allProjects);
    } else {
        const lowerCaseSearch = projectSearch.toLowerCase();
        setFilteredProjects(
            allProjects.filter(p => 
                p.name.toLowerCase().includes(lowerCaseSearch) || 
                p.code.toLowerCase().includes(lowerCaseSearch)
            )
        );
    }
  }, [projectSearch, allProjects]);

  const fetchProjectMembers = async (currentProjectId) => {
    if (!currentProjectId) {
      setProjectMembers([]);
      return;
    }
    const { data, error } = await supabase
        .from('project_members')
        .select('members(id, name)')
        .eq('project_id', currentProjectId);
    
    if (error) {
        console.error("Error fetching project members:", error);
        setProjectMembers([]);
    } else {
        setProjectMembers(data.map(item => item.members).filter(Boolean));
    }
  };

  useEffect(() => {
    if (isOpen) {
      const currentProjectId = task ? task.project_id : projectId || formData.project_id;
      if (currentProjectId) {
        fetchProjectMembers(currentProjectId);
      }
    }
  }, [isOpen, task, projectId, formData.project_id]);


  useEffect(() => {
    if (isOpen) {
        if (task) {
          setFormData({
            name: task.name || '',
            description: task.description || '',
            start_date: task.start_date ? format(new Date(task.start_date), 'yyyy-MM-dd') : '',
            end_date: task.end_date ? format(new Date(task.end_date), 'yyyy-MM-dd') : '',
            member_id: task.member_id || '',
            status: task.status || 'Nové',
            project_id: task.project_id || '',
          });
        } else {
          setFormData({ 
            name: '', 
            description: '',
            start_date: '', 
            end_date: '', 
            member_id: '', 
            status: 'Nové', 
            project_id: projectId || '' 
          });
        }
    }
  }, [task, isOpen, projectId]);
  
  useEffect(() => {
    if (!projectId) {
        fetchProjectMembers(formData.project_id);
    }
  }, [formData.project_id, projectId]);


  const handleSubmit = (e) => {
    e.preventDefault();
    
    if (!formData.name.trim()) {
      toast({
        title: "Chyba",
        description: "Prosím, vyplňte název úkolu.",
        variant: "destructive"
      });
      return;
    }

    if (!formData.start_date || !formData.end_date) {
      toast({
        title: "Chyba",
        description: "Prosím, vyplňte datum zahájení a ukončení.",
        variant: "destructive"
      });
      return;
    }

    if (new Date(formData.start_date) > new Date(formData.end_date)) {
      toast({
        title: "Chyba",
        description: "Datum zahájení nesmí být později než datum ukončení.",
        variant: "destructive"
      });
      return;
    }

    onSave({
      ...formData,
      member_id: formData.member_id || null,
    });
  };

  const handleDelete = () => {
    if (task && task.id && onDelete) {
      onDelete(task.id);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden">
        <DialogHeader className="pb-4">
          <DialogTitle className="text-2xl font-bold flex items-center gap-2">
            {task ? (
              <>
                <Edit2 className="h-6 w-6 text-primary" />
                Upravit úkol
              </>
            ) : (
              <>
                <Plus className="h-6 w-6 text-primary" />
                Nový úkol
              </>
            )}
          </DialogTitle>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="flex-1 overflow-hidden">
          <Tabs defaultValue="basic" className="h-full flex flex-col">
            <TabsList className="grid w-full grid-cols-3 mb-6">
              <TabsTrigger value="basic" className="flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Základní
              </TabsTrigger>
              <TabsTrigger value="assignment" className="flex items-center gap-2">
                <User className="h-4 w-4" />
                Přiřazení
              </TabsTrigger>
              <TabsTrigger value="schedule" className="flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                Termíny
              </TabsTrigger>
            </TabsList>
            
            <div className="flex-1 overflow-y-auto space-y-6 pr-2">
              {/* Basic Information Tab */}
              <TabsContent value="basic" className="space-y-6">
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-4"
                >
                  {!projectId && (
                    <div className="space-y-2">
                      <Label htmlFor="project" className="flex items-center gap-2 text-sm font-medium">
                        <Target className="h-4 w-4 text-muted-foreground" />
                        Projekt
                        <span className="text-red-500">*</span>
                      </Label>
                      <Select 
                        value={formData.project_id || 'none'} 
                        onValueChange={(value) => setFormData({ ...formData, project_id: value === 'none' ? '' : value, member_id: '' })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Vyberte projekt" />
                        </SelectTrigger>
                        <SelectContent>
                          <div className="p-2">
                            <div className="relative">
                              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                              <Input 
                                placeholder="Hledat projekt..." 
                                className="pl-8"
                                value={projectSearch} 
                                onChange={e => setProjectSearch(e.target.value)} 
                              />
                            </div>
                          </div>
                          <div className="max-h-[200px] overflow-y-auto">
                            <SelectItem value="none">-- Vyberte projekt --</SelectItem>
                            {filteredProjects.map(p => (
                              <SelectItem key={p.id} value={p.id}>{p.code} - {p.name}</SelectItem>
                            ))}
                          </div>
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label htmlFor="name" className="flex items-center gap-2 text-sm font-medium">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      Název úkolu
                      <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="name"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      required
                      placeholder="Zadejte název úkolu"
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="description" className="flex items-center gap-2 text-sm font-medium">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      Detailní popis
                    </Label>
                    <Textarea
                      id="description"
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      placeholder="Přidejte podrobnější informace o úkolu..."
                      rows={4}
                      className="resize-none"
                    />
                  </div>
                </motion.div>
              </TabsContent>

              {/* Assignment Tab */}
              <TabsContent value="assignment" className="space-y-6">
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-4"
                >
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="member" className="flex items-center gap-2 text-sm font-medium">
                        <User className="h-4 w-4 text-muted-foreground" />
                        Přiřadit projektantovi
                      </Label>
                      <Select
                        value={formData.member_id || 'none'}
                        onValueChange={(value) => setFormData({ ...formData, member_id: value === 'none' ? '' : value })}
                        disabled={!formData.project_id || projectMembers.length === 0}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="-- Nepřiřazeno --" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">-- Nepřiřazeno --</SelectItem>
                          {projectMembers.map(m => (
                            <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {(!formData.project_id || projectMembers.length === 0) && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3" />
                          Nejdříve vyberte projekt
                        </p>
                      )}
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="status" className="flex items-center gap-2 text-sm font-medium">
                        <Target className="h-4 w-4 text-muted-foreground" />
                        Stav úkolu
                      </Label>
                      <Select
                        value={formData.status}
                        onValueChange={(value) => setFormData({ ...formData, status: value })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {taskStatuses.map(status => (
                            <SelectItem key={status} value={status}>{status}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </motion.div>
              </TabsContent>

              {/* Schedule Tab */}
              <TabsContent value="schedule" className="space-y-6">
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-4"
                >
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="startDate" className="flex items-center gap-2 text-sm font-medium">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                        Datum zahájení
                        <span className="text-red-500">*</span>
                      </Label>
                      <Input
                        id="startDate"
                        type="date"
                        value={formData.start_date}
                        onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                        required
                      />
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="endDate" className="flex items-center gap-2 text-sm font-medium">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                        Datum ukončení
                        <span className="text-red-500">*</span>
                      </Label>
                      <Input
                        id="endDate"
                        type="date"
                        value={formData.end_date}
                        onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
                        required
                      />
                    </div>
                  </div>
                  
                  {formData.start_date && formData.end_date && (
                    <motion.div 
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="p-4 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg"
                    >
                      <div className="text-center">
                        <p className="text-sm text-blue-800 font-medium">Délka úkolu</p>
                        <p className="text-lg font-bold text-blue-900">
                          {Math.ceil((new Date(formData.end_date) - new Date(formData.start_date)) / (1000 * 60 * 60 * 24)) + 1} dní
                        </p>
                      </div>
                    </motion.div>
                  )}
                </motion.div>
              </TabsContent>
            </div>
            
            <DialogFooter className="pt-6 border-t flex-col sm:flex-row sm:justify-between sm:items-center">
              {task && isAdmin && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button type="button" variant="destructive" className="w-full sm:w-auto sm:mr-auto">
                      <Trash2 className="w-4 h-4 mr-2" /> Smazat úkol
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Opravdu smazat tento úkol?</AlertDialogTitle>
                      <AlertDialogDescription>Tato akce je nevratná.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Zrušit</AlertDialogCancel>
                      <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">
                        Smazat
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 w-full sm:w-auto">
                <Button type="button" variant="outline" onClick={onClose} className="w-full sm:w-auto">
                  Zrušit
                </Button>
                <Button type="submit" className="w-full sm:w-auto min-w-[120px]">
                  {task ? 'Uložit změny' : 'Přidat úkol'}
                </Button>
              </div>
            </DialogFooter>
          </Tabs>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default TaskDialog;