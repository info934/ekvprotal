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
  const { hasPermission, memberId, isSuperUser } = useAuth();
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
        const { data: userProjects } = await supabase.rpc('get_user_projects', { p_member_id: memberId });
        const projectIds = userProjects.map(p => p.id);
        query = query.in('project_id', projectIds);
    }

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) {
      toast({ title: 'Chyba při načítání dokumentů', variant: 'destructive' });
    } else {
      setDocuments(data);
    }
  }, [searchTerm, selectedProject, toast, isSuperUser, memberId]);

  const fetchProjects = useCallback(async () => {
    let projectQuery;
    if (isSuperUser) {
        projectQuery = supabase.from('projects').select('id, name, code');
    } else {
        projectQuery = supabase.rpc('get_user_projects', { p_member_id: memberId });
    }
    const { data, error } = await projectQuery.order('code');
    if (!error) {
      setProjects(data);
      setFilteredProjects(data);
    }
  }, [isSuperUser, memberId]);

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

  const handleDownloadFile = async (filePath, fileName) => {
    if (!filePath) {
        toast({ title: 'Chyba', description: 'Cesta k souboru není definována.', variant: 'destructive' });
        return;
    }
    const { data, error } = await supabase.storage.from('project-files').download(filePath);
    if (error) {
        toast({ title: 'Chyba při stahování', description: 'Soubor nebyl nalezen nebo k němu nemáte přístup.', variant: 'destructive' });
        return;
    }
    const blob = new Blob([data]);
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
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

    const fileExt = file.name.split('.').pop();
    const fileName = `${project.code}/${restOfDocData.name.replace(/\s+/g, '_')}_${Date.now()}.${fileExt}`;
    const filePath = `${project_id}/${fileName}`;

    const { error: uploadError } = await supabase.storage.from('project-files').upload(filePath, file);

    if (uploadError) {
        toast({ title: "🛑 Chyba při nahrávání souboru", description: uploadError.message, variant: "destructive" });
        return;
    }

    const { error } = await supabase.from('documents').insert({ 
        ...restOfDocData, 
        project_id: project_id, 
        file_name: file.name, 
        file_path: filePath,
    });

    if (error) {
        toast({ title: "🛑 Chyba při ukládání dokumentu", variant: "destructive" });
        await supabase.storage.from('project-files').remove([filePath]);
        return;
    }
    
    fetchDocuments();
    toast({ title: "✅ Dokument úspěšně nahrán!" });
};

  const openAddDocumentDialog = () => {
    setDocDialogPayload({ projects });
    setIsDocDialogOpen(true);
  }


  return (
    <div className="space-y-6">
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

      <div className="glass-effect rounded-xl p-6">
        <div className="mb-6 flex flex-wrap gap-4">
          <div className="relative flex-grow">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Hledat dokumenty..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 bg-white"
            />
          </div>
          <div className="flex-grow sm:flex-grow-0">
             <Select value={selectedProject || 'all'} onValueChange={(value) => setSelectedProject(value === 'all' ? undefined : value)}>
                <SelectTrigger className="w-full sm:w-64 h-full bg-white">
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
                                {doc.file_path && (
                                    <Button variant="ghost" size="icon" onClick={() => handleDownloadFile(doc.file_path, doc.file_name)}>
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
