import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Plus, Search, FileText, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from '@/components/ui/input';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import DocumentDialog from '@/components/DocumentDialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format } from 'date-fns';
import PageHeader from '@/components/ui/page-header';
import {
  downloadProjectDocument,
  isStorageConfigMissingError,
  uploadProjectDocument,
} from '@/lib/documentStorageService';

const statusConfig = {
  in_work: { label: 'V práci', color: 'bg-blue-100 text-blue-800 border-blue-200' },
  internal_review: { label: 'Interní revize', color: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
  sent_out: { label: 'Odesláno', color: 'bg-purple-100 text-purple-800 border-purple-200' },
  waiting_response: { label: 'Čeká na odpověď', color: 'bg-orange-100 text-orange-800 border-orange-200' },
  approved: { label: 'Schváleno', color: 'bg-green-100 text-green-800 border-green-200' },
  rejected: { label: 'Zamítnuto', color: 'bg-red-100 text-red-800 border-red-200' },
  archived: { label: 'Archivováno', color: 'bg-slate-100 text-slate-800 border-slate-200' },
  'Zápis z KD': { label: 'Zápis z KD', color: 'bg-teal-100 text-teal-800 border-teal-200' },
  'Příloha': { label: 'Příloha', color: 'bg-indigo-100 text-indigo-800 border-indigo-200' },
};


const Documents = () => {
  const { toast } = useToast();
  const { hasPermission, isSuperUser } = useAuth();
  const [documents, setDocuments] = useState([]);
  const [projects, setProjects] = useState([]);
  const [filteredProjects, setFilteredProjects] = useState([]);
  const [projectSearch, setProjectSearch] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedProject, setSelectedProject] = useState(undefined);
  const [isDocDialogOpen, setIsDocDialogOpen] = useState(false);
  const [docDialogPayload, setDocDialogPayload] = useState({});

  const fetchDocuments = useCallback(async () => {
    let query = supabase.from('documents').select('*, projects(name, code)');
    
    if (searchTerm) {
      query = query.or(`name.ilike.%${searchTerm}%,projects.name.ilike.%${searchTerm}%`);
    }

    if (selectedProject) {
      query = query.eq('project_id', selectedProject);
    } else if (!isSuperUser) {
        const { data: userProjects } = await supabase.rpc('list_projects_safe');
        const projectIds = userProjects.map(p => p.id);
        query = query.in('project_id', projectIds);
    }

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) {
      toast({ title: 'Chyba při načítání dokumentů', variant: 'destructive' });
    } else {
      setDocuments(data);
    }
  }, [searchTerm, selectedProject, toast, isSuperUser]);

  const fetchProjects = useCallback(async () => {
    let projectQuery;
    if (isSuperUser) {
        projectQuery = supabase.from('projects').select('id, name, code');
    } else {
        projectQuery = supabase.rpc('list_projects_safe');
    }
    const { data, error } = isSuperUser ? await projectQuery.order('code') : await projectQuery;
    if (!error) {
      const nextProjects = [...(data || [])].sort((a, b) => String(a.code || '').localeCompare(String(b.code || ''), 'cs'));
      setProjects(nextProjects);
      setFilteredProjects(nextProjects);
    }
  }, [isSuperUser]);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);
  
  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  useEffect(() => {
     if(projectSearch.trim() === '') {
        setFilteredProjects(projects);
    } else {
        setFilteredProjects(
            projects.filter(p => 
                p.name.toLowerCase().includes(projectSearch.toLowerCase()) || 
                p.code.toLowerCase().includes(projectSearch.toLowerCase())
            )
        );
    }
  }, [projectSearch, projects]);

  const handleDownloadFile = async (document) => {
    try {
      await downloadProjectDocument(document);
    } catch (error) {
      toast({
        title: 'Chyba při stahování',
        description: error.message || 'Soubor nebyl nalezen nebo k němu nemáte přístup.',
        variant: 'destructive',
      });
    }
  };
  
  const handleAddDocument = async (docData) => {
    if (!hasPermission('documents', 'can_edit')) return;
    const { file, project_id, ...restOfDocData } = docData;

    if (!file) {
        toast({ title: "🛑 Chybí soubor", variant: "destructive" });
        return;
    }
    
    const project = projects.find(p => p.id === project_id);
    if (!project) {
        toast({ title: "🛑 Projekt nenalezen", variant: "destructive" });
        return;
    }

    let uploadResult;
    try {
      uploadResult = await uploadProjectDocument({
        file,
        project,
        documentName: restOfDocData.name,
      });
    } catch (uploadError) {
        toast({ title: "🛑 Chyba při nahrávání souboru", description: uploadError.message, variant: "destructive" });
        return;
    }

    const basePayload = {
        ...restOfDocData, 
        project_id: project_id, 
        file_name: file.name, 
        file_path: uploadResult.filePath,
    };

    const { error } = await supabase.from('documents').insert({
        ...basePayload,
        ...uploadResult.storageFields,
    });

    if (error) {
        if (isStorageConfigMissingError(error) && uploadResult.provider === 'supabase') {
          const { error: fallbackError } = await supabase.from('documents').insert(basePayload);
          if (!fallbackError) {
            fetchDocuments();
            toast({ title: "Dokument úspěšně nahrán" });
            return;
          }
        }

        toast({ title: "🛑 Chyba při ukládání dokumentu", description: error.message, variant: "destructive" });
        if (uploadResult.cleanup) await uploadResult.cleanup();
        return;
    }
    
    fetchDocuments();
    toast({ title: "Dokument úspěšně nahrán" });
};

  const openAddDocumentDialog = () => {
    setDocDialogPayload({ projects });
    setIsDocDialogOpen(true);
  }


  return (
    <div className="app-page">
      <PageHeader
        icon={FileText}
        title="Dokumentace"
        description="Správa projektové dokumentace a verzí"
        actions={hasPermission('documents', 'can_edit') && (
          <Button onClick={openAddDocumentDialog}>
            <Plus className="w-4 h-4 mr-2" />
            Nový dokument
          </Button>
        )}
      />
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="hidden"
      >
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold gradient-text mb-2 flex items-center gap-3">
            <FileText className="w-8 h-8" />
            Dokumentace
          </h1>
          <p className="text-muted-foreground">Správa projektové dokumentace a verzí</p>
        </div>
        {hasPermission('documents', 'can_edit') &&
            <Button
              onClick={openAddDocumentDialog}
              className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 shadow-lg"
            >
              <Plus className="w-4 h-4 mr-2" />
              Nový dokument
            </Button>
        }
      </motion.div>

      <div className="crm-panel p-4 sm:p-5">
        <div className="mb-6 flex flex-wrap gap-4">
          <div className="relative flex-grow">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Hledat dokumenty..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="h-10 w-full rounded-md border border-slate-200 bg-white py-2 pl-10 pr-4 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <div className="flex-grow sm:flex-grow-0">
             <Select value={selectedProject || 'all'} onValueChange={(value) => setSelectedProject(value === 'all' ? undefined : value)}>
                <SelectTrigger className="h-10 w-full bg-white sm:w-64">
                    <SelectValue placeholder="Všechny projekty" />
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
                        <SelectItem value="all">Všechny projekty</SelectItem>
                        {filteredProjects.map(p => (
                            <SelectItem key={p.id} value={p.id}>({p.code}) {p.name}</SelectItem>
                        ))}
                    </div>
                </SelectContent>
             </Select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
                <TableRow>
                    <TableHead>Název dokumentu</TableHead>
                    <TableHead>Projekt</TableHead>
                    <TableHead>Verze</TableHead>
                    <TableHead>Typ</TableHead>
                    <TableHead>Stav</TableHead>
                    <TableHead>Datum nahrání</TableHead>
                    <TableHead className="text-right">Akce</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {documents.map((doc) => {
                    const statusKey = doc.type === 'Zápis z KD' || doc.type === 'Příloha' ? doc.type : doc.status;
                    const config = statusConfig[statusKey] || {};
                    return (
                        <TableRow key={doc.id}>
                            <TableCell className="font-medium">{doc.name}</TableCell>
                            <TableCell>{doc.projects?.code}</TableCell>
                            <TableCell>{doc.version}</TableCell>
                            <TableCell>{doc.type}</TableCell>
                            <TableCell>
                                <span className={`px-2 py-1 text-xs font-medium rounded-full border ${config.color}`}>{config.label}</span>
                            </TableCell>
                            <TableCell>{format(new Date(doc.created_at), 'd.M.yyyy')}</TableCell>
                            <TableCell className="text-right">
                                {(doc.file_path || doc.external_web_url) && (
                                    <Button variant="ghost" size="icon" onClick={() => handleDownloadFile(doc)}>
                                       <Download className="w-5 h-5"/>
                                    </Button>
                                )}
                            </TableCell>
                        </TableRow>
                    )
                })}
            </TableBody>
          </Table>
        </div>

        {documents.length === 0 && (
          <div className="text-center py-12">
            <FileText className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">Žádné dokumenty nenalezeny</p>
          </div>
        )}
      </div>
      <DocumentDialog isOpen={isDocDialogOpen} onClose={() => setIsDocDialogOpen(false)} onSave={handleAddDocument} payload={docDialogPayload} />
    </div>
  );
};

export default Documents;
