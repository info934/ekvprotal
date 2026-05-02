import React, { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Upload, FileUp, X, Search } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { useDropzone } from 'react-dropzone';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from '@/lib/utils';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ChevronsUpDown, Check } from "lucide-react";

const DocumentDialog = ({ isOpen, onClose, onSave, isMeetingMinutes = false, payload = {} }) => {
  const { toast } = useToast();
  const [formData, setFormData] = useState({
    name: '',
    type: 'PD',
    discipline: '',
    status: 'in_work',
    version: '1.0',
    structureId: '',
    assignmentFile: false,
    project_id: null,
  });
  const [file, setFile] = useState(null);
  
  const [projects, setProjects] = useState([]);
  const [openProjectCombobox, setOpenProjectCombobox] = useState(false);

  const onDrop = useCallback((acceptedFiles) => {
    if (acceptedFiles && acceptedFiles[0]) {
      const selectedFile = acceptedFiles[0];
      setFile(selectedFile);
      if (!formData.name && !isMeetingMinutes) {
        setFormData(prev => ({ ...prev, name: selectedFile.name.replace(/\.[^/.]+$/, "") }));
      }
    }
  }, [formData.name, isMeetingMinutes]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'application/msword': ['.doc'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'application/vnd.ms-excel': ['.xls'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
    },
    maxFiles: 1,
  });

  useEffect(() => {
    if (isOpen) {
        const initialName = payload.initialName || (isMeetingMinutes ? `Zápis z KD - ${new Date().toLocaleDateString('cs-CZ')}` : (payload.assignmentFile ? 'Příloha k zadání' : ''));
        setFormData({
            name: initialName,
            type: isMeetingMinutes ? 'Zápis z KD' : (payload.assignmentFile ? 'Příloha' : 'PD'),
            discipline: '',
            status: 'in_work',
            version: '1.0',
            structureId: payload.structureId || '',
            assignmentFile: !!payload.assignmentFile,
            project_id: payload.projectId || null,
        });
        setFile(null);
        if (!payload.projectId && payload.projects) {
          setProjects(payload.projects);
        }
    }
  }, [isOpen, isMeetingMinutes, payload]);


  const handleSubmit = (e) => {
    e.preventDefault();
    if (!file) {
      toast({ title: "Chybí soubor", description: "Prosím, nahrajte soubor.", variant: "destructive" });
      return;
    }
    if (isGlobalAdd && !formData.project_id) {
        toast({ title: "Chybí projekt", description: "Prosím, vyberte projekt.", variant: "destructive" });
        return;
    }
    onSave({...formData, file});
    onClose();
  };
  
  const isForStructure = !!payload.structureId;
  const isForAssignment = !!payload.assignmentFile;
  const isGlobalAdd = !payload.projectId;

  const projectOptions = (projects || []).map(p => ({ value: p.id, label: `(${p.code}) ${p.name}` }));

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Nahrát nový dokument</DialogTitle>
          <DialogDescription>
            {isMeetingMinutes ? 'Přidejte nový zápis z kontrolního dne.' : (isForStructure ? 'Nahrát soubor pro položku rozpisky.' : (isForAssignment ? 'Nahrát novou přílohu k zadání.' : 'Přidejte nový projektový dokument.'))}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          
          {isGlobalAdd && (
            <div>
              <Label htmlFor="project">Projekt *</Label>
              <Popover open={openProjectCombobox} onOpenChange={setOpenProjectCombobox}>
                <PopoverTrigger asChild>
                    <Button variant="outline" role="combobox" aria-expanded={openProjectCombobox} className="w-full justify-between">
                        {formData.project_id ? projectOptions.find(p => p.value === formData.project_id)?.label : "Vyberte projekt..."}
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                    <Command>
                        <CommandInput placeholder="Hledat projekt..." />
                        <CommandEmpty>Projekt nenalezen.</CommandEmpty>
                        <CommandGroup>
                          <CommandList>
                            {projectOptions.map((option) => (
                                <CommandItem key={option.value} value={option.label} onSelect={() => {
                                    setFormData(prev => ({...prev, project_id: option.value}));
                                    setOpenProjectCombobox(false);
                                }}>
                                    <Check className={cn("mr-2 h-4 w-4", formData.project_id === option.value ? "opacity-100" : "opacity-0")} />
                                    {option.label}
                                </CommandItem>
                            ))}
                          </CommandList>
                        </CommandGroup>
                    </Command>
                </PopoverContent>
              </Popover>
            </div>
          )}

          <div>
            <Label htmlFor="name">Název *</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
              readOnly={isForStructure && !isMeetingMinutes}
              className={cn("bg-white", isForStructure && !isMeetingMinutes ? 'bg-gray-100' : '')}
            />
             {isForStructure && !isMeetingMinutes && <p className="text-xs text-muted-foreground mt-1">Název je předvyplněn z rozpisky.</p>}
          </div>

          {!isMeetingMinutes && !isForStructure && !isForAssignment && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="type">Typ dokumentu</Label>
                 <Select value={formData.type} onValueChange={(value) => setFormData({ ...formData, type: value })}>
                    <SelectTrigger className="w-full bg-white"><SelectValue/></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="PD">PD</SelectItem>
                        <SelectItem value="DSP">DSP</SelectItem>
                        <SelectItem value="DPS">DPS</SelectItem>
                        <SelectItem value="PBŘ">PBŘ</SelectItem>
                        <SelectItem value="LPS">LPS</SelectItem>
                    </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="discipline">Disciplína</Label>
                <Input id="discipline" value={formData.discipline} onChange={(e) => setFormData({ ...formData, discipline: e.target.value })} className="bg-white" />
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="version">Verze</Label>
              <Input id="version" value={formData.version} onChange={(e) => setFormData({ ...formData, version: e.target.value })} className="bg-white" />
            </div>
             {!isMeetingMinutes && !isForStructure && !isForAssignment && (
              <div>
                <Label htmlFor="status">Stav</Label>
                <Select value={formData.status} onValueChange={(value) => setFormData({ ...formData, status: value })}>
                    <SelectTrigger className="w-full bg-white"><SelectValue/></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="in_work">V práci</SelectItem>
                        <SelectItem value="internal_review">Interní revize</SelectItem>
                        <SelectItem value="sent_out">Odesláno</SelectItem>
                        <SelectItem value="waiting_response">Čeká na odpověď</SelectItem>
                        <SelectItem value="approved">Schváleno</SelectItem>
                        <SelectItem value="rejected">Zamítnuto</SelectItem>
                        <SelectItem value="archived">Archivováno</SelectItem>
                    </SelectContent>
                </Select>
              </div>
             )}
          </div>
          
          <div>
            <Label>Soubor *</Label>
            {file ? (
                <div className="mt-2 flex items-center justify-between p-3 border rounded-lg bg-green-50 text-green-800">
                    <div className="flex items-center gap-2">
                        <FileUp className="w-5 h-5"/>
                        <span className="font-medium text-sm">{file.name}</span>
                    </div>
                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-green-800" onClick={() => setFile(null)}>
                        <X className="w-4 h-4" />
                    </Button>
                </div>
            ) : (
                <div {...getRootProps()} className={cn("mt-2 flex justify-center items-center px-6 py-10 border-2 border-dashed rounded-md cursor-pointer hover:border-purple-500 transition-colors", isDragActive && "border-purple-500 bg-purple-50")}>
                    <input {...getInputProps()} />
                    <div className="space-y-1 text-center">
                        <Upload className="mx-auto h-12 w-12 text-muted-foreground" />
                        {isDragActive ? (
                            <p className="font-semibold text-purple-600">Sem přetáhněte soubor</p>
                        ) : (
                             <p className="text-sm text-muted-foreground">Přetáhněte soubor sem, nebo <span className="font-medium text-purple-600">klikněte pro výběr</span></p>
                        )}
                        <p className="text-xs text-muted-foreground">PDF, DOCX, XLSX do 10MB</p>
                    </div>
                </div>
            )}
          </div>


          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="outline" onClick={onClose}>
              Zrušit
            </Button>
            <Button type="submit" className="bg-gradient-to-r from-purple-600 to-indigo-600">
              Uložit a nahrát
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default DocumentDialog;