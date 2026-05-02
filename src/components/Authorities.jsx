import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Plus, Building2, Clock, CheckCircle, Edit, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import AuthorityDialog from '@/components/AuthorityDialog';
import { supabase } from '@/lib/customSupabaseClient';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";

const statusConfig = {
  pending: { label: 'Čeká se', icon: Clock, color: 'text-orange-700', bg: 'bg-orange-100' },
  received: { label: 'Přijato', icon: CheckCircle, color: 'text-green-700', bg: 'bg-green-100' },
};

const Statements = () => {
  const { toast } = useToast();
  const [statements, setStatements] = useState([]);
  const [projects, setProjects] = useState([]);
  const [selectedProject, setSelectedProject] = useState('');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingStatement, setEditingStatement] = useState(null);

  const fetchStatements = useCallback(async () => {
    let query = supabase
      .from('statements')
      .select('*, projects(name)');
      
    if (selectedProject) {
      query = query.eq('project_id', selectedProject);
    }
      
    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) {
      toast({ title: "Chyba při načítání vyjádření.", variant: "destructive" });
    } else {
      setStatements(data);
    }
  }, [toast, selectedProject]);

  useEffect(() => {
    const fetchProjects = async () => {
      const { data, error } = await supabase.from('projects').select('id, name').order('name');
      if (!error) setProjects(data);
    };
    fetchProjects();
    fetchStatements();
  }, [fetchStatements]);

  const handleSaveStatement = async (statementData) => {
    if (editingStatement) {
      const { error } = await supabase.from('statements').update(statementData).eq('id', editingStatement.id);
      if (error) { toast({ title: "Chyba při úpravě.", variant: "destructive" }); } 
      else { toast({ title: "✅ Vyjádření upraveno!" }); }
    } else {
      const { error } = await supabase.from('statements').insert([statementData]);
      if (error) { toast({ title: "Chyba při vytváření.", variant: "destructive" }); }
      else { toast({ title: "✅ Žádost o vyjádření vytvořena!" }); }
    }
    fetchStatements();
    setIsDialogOpen(false);
    setEditingStatement(null);
  };

  const handleDeleteStatement = async (id) => {
    const { error } = await supabase.from('statements').delete().eq('id', id);
    if (error) { toast({ title: "Chyba při mazání.", variant: "destructive" }); }
    else { toast({ title: "🗑️ Žádost smazána." }); fetchStatements(); }
  };

  const handleOpenDialog = (statement = null) => {
    setEditingStatement(statement);
    setIsDialogOpen(true);
  };

  return (
    <div className="space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between"
      >
        <div>
          <h1 className="text-4xl font-bold gradient-text mb-2">Vyjádření</h1>
          <p className="text-muted-foreground">Správa žádostí o vyjádření od úřadů a správců sítí</p>
        </div>
        <Button
          onClick={() => handleOpenDialog()}
          className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 shadow-lg"
        >
          <Plus className="w-4 h-4 mr-2" />
          Nová žádost
        </Button>
      </motion.div>

      <div className="glass-effect rounded-xl p-4">
        <div className="mb-4">
          <label htmlFor="project-filter" className="block text-sm font-medium text-muted-foreground mb-1">
            Filtrovat podle projektu
          </label>
          <select
            id="project-filter"
            value={selectedProject}
            onChange={(e) => setSelectedProject(e.target.value)}
            className="w-full max-w-xs px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
          >
            <option value="">Všechny projekty</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {statements.map((statement, index) => {
          const config = statusConfig[statement.status] || statusConfig.pending;
          const Icon = config.icon;
          return (
            <motion.div
              key={statement.id}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: index * 0.05 }}
              className="glass-effect rounded-lg p-5 flex flex-col"
            >
              <div className="flex-grow">
                <div className="flex items-start gap-3 mb-4">
                  <div className="p-3 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-lg">
                    <Building2 className="w-5 h-5 text-white" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-bold">{statement.authority_name}</h3>
                    <p className="text-sm text-muted-foreground">{statement.projects?.name || 'Nespecifikovaný projekt'}</p>
                  </div>
                </div>

                <div className="space-y-2 mb-4">
                  {statement.deadline && (
                    <div className="flex items-center gap-2 text-sm">
                      <Clock className="w-4 h-4 text-muted-foreground" />
                      <span>Lhůta: {new Date(statement.deadline).toLocaleDateString('cs-CZ')}</span>
                    </div>
                  )}
                  {statement.description && <p className="text-sm text-muted-foreground">{statement.description}</p>}
                </div>
              </div>

              <div className="flex justify-between items-center">
                <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium ${config.bg} ${config.color}`}>
                  <Icon className="w-3 h-3" />
                  {config.label}
                </div>
                <div className="flex items-center">
                  <Button variant="ghost" size="icon" onClick={() => handleOpenDialog(statement)}>
                    <Edit className="w-4 h-4" />
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon">
                        <Trash2 className="w-4 h-4 text-red-500" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Opravdu smazat žádost?</AlertDialogTitle>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Zrušit</AlertDialogCancel>
                        <AlertDialogAction onClick={() => handleDeleteStatement(statement.id)} className="bg-red-600 hover:bg-red-700">Smazat</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>

      {statements.length === 0 && (
        <div className="glass-effect rounded-xl p-12 text-center">
          <Building2 className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">Pro vybraný filtr nebyly nalezeny žádné žádosti.</p>
        </div>
      )}

      <AuthorityDialog
        isOpen={isDialogOpen}
        onClose={() => { setIsDialogOpen(false); setEditingStatement(null); }}
        onSave={handleSaveStatement}
        statement={editingStatement}
      />
    </div>
  );
};

export default Statements;