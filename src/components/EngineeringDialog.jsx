import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from "@/components/ui/use-toast";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search } from 'lucide-react';

const EngineeringDialog = ({ isOpen, onClose, onSave, activity, projectId }) => {
  const [formData, setFormData] = useState({
    project_id: '',
    subject: '',
    description: '',
    start_date: '',
    end_date: '',
    status: 'new',
    category: 'dotceny_stavbou',
    dny_na_vyjadreni: null,
    no_document: false,
    is_urgent: false,
  });
  const [projects, setProjects] = useState([]);
  const [filteredProjects, setFilteredProjects] = useState([]);
  const [projectSearch, setProjectSearch] = useState('');
  const [subjects, setSubjects] = useState([]);
  const [file, setFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    const fetchDropdownData = async () => {
      if (!projectId) {
        const { data: projectsData, error: projectsError } = await supabase.from('projects').select('id, name, code').order('code');
        if (!projectsError) {
          setProjects(projectsData);
          setFilteredProjects(projectsData);
        }
      }
      const { data: subjectsData, error: subjectsError } = await supabase.from('engineering_subjects').select('name').order('name');
      if (!subjectsError) setSubjects(subjectsData.map(s => s.name));
    };
    
    if (isOpen) {
        fetchDropdownData();
    }
  }, [isOpen, projectId]);

  useEffect(() => {
    if(projectSearch.trim() === '') {
        setFilteredProjects(projects);
    } else {
        const lowerCaseSearch = projectSearch.toLowerCase();
        setFilteredProjects(
            projects.filter(p => 
                p.name.toLowerCase().includes(lowerCaseSearch) || 
                (p.code && p.code.toLowerCase().includes(lowerCaseSearch))
            )
        );
    }
  }, [projectSearch, projects]);

  useEffect(() => {
    if (isOpen) {
      if (activity) {
        setFormData({
          project_id: activity.project_id || projectId || '',
          subject: activity.subject || '',
          description: activity.description || '',
          start_date: activity.start_date || '',
          end_date: activity.end_date || '',
          status: activity.status || 'new',
          category: activity.category || 'dotceny_stavbou',
          dny_na_vyjadreni: activity.dny_na_vyjadreni || null,
          no_document: activity.no_document || false,
          is_urgent: activity.is_urgent || false,
        });
      } else {
        setFormData({
          project_id: projectId || '',
          subject: '',
          description: '',
          start_date: '',
          end_date: '',
          status: 'new',
          category: 'dotceny_stavbou',
          dny_na_vyjadreni: null,
          no_document: false,
          is_urgent: false,
        });
      }
      setFile(null);
      setIsUploading(false);
    }
  }, [activity, isOpen, projectId]);

  const handleFileChange = (e) => {
    if (e.target.files.length > 0) {
      setFile(e.target.files[0]);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (formData.status === 'done' && !file && !activity?.file_url && !formData.no_document) {
        toast({
            title: "Chybí vyjádření",
            description: "Při dokončení činnosti prosím nahrajte soubor s vyjádřením, nebo zaškrtněte, že dokument neexistuje.",
            variant: "destructive",
        });
        return;
    }

    setIsUploading(true);

    const dataToSave = {
        ...formData,
        start_date: formData.start_date || null,
        end_date: formData.end_date || null,
        dny_na_vyjadreni: formData.dny_na_vyjadreni === '' || formData.dny_na_vyjadreni === null ? null : Number(formData.dny_na_vyjadreni)
    };
    
    if (file) {
      const fileName = `${Date.now()}-${file.name}`;
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('engineering-files')
        .upload(fileName, file);

      if (uploadError) {
        toast({ title: 'Chyba při nahrávání souboru', description: uploadError.message, variant: 'destructive' });
        setIsUploading(false);
        return;
      }
      
      const { data: urlData } = supabase.storage.from('engineering-files').getPublicUrl(uploadData.path);
      dataToSave.file_url = urlData.publicUrl;
      dataToSave.file_name = file.name;
    } else if (activity) {
        dataToSave.file_url = activity.file_url;
        dataToSave.file_name = activity.file_name;
    }

    if (dataToSave.subject && !subjects.includes(dataToSave.subject)) {
        await supabase.from('engineering_subjects').insert({ name: dataToSave.subject }).select();
    }
    
    onSave(dataToSave);
    setIsUploading(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{activity ? 'Upravit činnost' : 'Nová inženýrská činnost'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {!projectId && (
             <div>
              <Label htmlFor="project_id">Projekt *</Label>
              <Select required value={formData.project_id || ''} onValueChange={(value) => setFormData({ ...formData, project_id: value })}>
                  <SelectTrigger className="w-full bg-white">
                      <SelectValue placeholder="Vyberte projekt" />
                  </SelectTrigger>
                  <SelectContent>
                      <div className="p-2">
                        <div className="relative">
                            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input 
                                placeholder="Hledat projekt..." 
                                className="pl-8 bg-white"
                                value={projectSearch} 
                                onChange={e => setProjectSearch(e.target.value)} 
                            />
                        </div>
                      </div>
                      <div className="max-h-[200px] overflow-y-auto">
                        {filteredProjects.map(p => (
                            <SelectItem key={p.id} value={p.id}>{p.code} - {p.name}</SelectItem>
                        ))}
                      </div>
                  </SelectContent>
              </Select>
            </div>
          )}

          <div>
              <Label htmlFor="category">Kategorie</Label>
              <Select
                id="category"
                value={formData.category}
                onValueChange={(value) => setFormData({ ...formData, category: value })}
              >
                <SelectTrigger className="w-full bg-white"><SelectValue/></SelectTrigger>
                <SelectContent>
                    <SelectItem value="dotceny_stavbou">Dotčený stavbou</SelectItem>
                    <SelectItem value="doss">DOSS</SelectItem>
                    <SelectItem value="vyjadreni_siti">Vyjádření existence sítí</SelectItem>
                    <SelectItem value="ostatni">Ostatní</SelectItem>
                </SelectContent>
              </Select>
            </div>
          
          <div>
            <Label htmlFor="subject">Předmět / Subjekt *</Label>
            <Input
              id="subject"
              value={formData.subject}
              onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
              required
              list="subject-suggestions"
              className="bg-white"
            />
            <datalist id="subject-suggestions">
                {subjects.map((subject, index) => (
                    <option key={index} value={subject} />
                ))}
            </datalist>
          </div>

          <div>
            <Label htmlFor="description">Popis činnosti</Label>
            <textarea
              id="description"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full px-3 py-2 border rounded-md min-h-[80px] bg-white"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="start_date">Datum zahájení</Label>
              <Input
                id="start_date"
                type="date"
                value={formData.start_date}
                onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                className="bg-white"
              />
            </div>
            <div>
              <Label htmlFor="end_date">Termín dokončení</Label>
              <Input
                id="end_date"
                type="date"
                value={formData.end_date}
                onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
                className="bg-white"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
             <div>
              <Label htmlFor="dny_na_vyjadreni">Dní na vyjádření</Label>
              <Input
                id="dny_na_vyjadreni"
                type="number"
                value={formData.dny_na_vyjadreni || ''}
                onChange={(e) => setFormData({ ...formData, dny_na_vyjadreni: e.target.value })}
                className="bg-white"
              />
            </div>
            <div>
              <Label htmlFor="status">Stav</Label>
              <Select
                id="status"
                value={formData.status}
                onValueChange={(value) => setFormData({ ...formData, status: value })}
              >
                <SelectTrigger className="w-full bg-white"><SelectValue/></SelectTrigger>
                <SelectContent>
                    <SelectItem value="new">Nová</SelectItem>
                    <SelectItem value="in_progress">V řešení</SelectItem>
                    <SelectItem value="done">Hotovo</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          
          <div>
            <Label htmlFor="file">Příloha (vyjádření)</Label>
            <Input id="file" type="file" onChange={handleFileChange} className="bg-white"/>
            {activity?.file_name && !file && <p className="text-sm text-muted-foreground mt-1">Stávající soubor: {activity.file_name}</p>}
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Checkbox 
                id="is_urgent"
                checked={formData.is_urgent}
                onCheckedChange={(checked) => setFormData(prev => ({ ...prev, is_urgent: checked }))}
              />
              <label
                htmlFor="is_urgent"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                Urgentní
              </label>
            </div>

            {formData.status === 'done' && (
                <div className="flex items-center space-x-2">
                  <Checkbox 
                    id="no_document"
                    checked={formData.no_document}
                    onCheckedChange={(checked) => setFormData(prev => ({ ...prev, no_document: checked }))}
                  />
                  <label
                    htmlFor="no_document"
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                  >
                    Bez dokumentu
                  </label>
                </div>
            )}
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="outline" onClick={onClose}>
              Zrušit
            </Button>
            <Button type="submit" className="bg-gradient-to-r from-purple-600 to-indigo-600" disabled={isUploading}>
              {isUploading ? 'Ukládání...' : (activity ? 'Uložit změny' : 'Vytvořit činnost')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default EngineeringDialog;