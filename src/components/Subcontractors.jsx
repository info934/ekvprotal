import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Plus, Users, Star, Phone, Mail, Edit, Trash2, Briefcase, LayoutGrid, Rows } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import SubcontractorDialog from '@/components/SubcontractorDialog';
import { supabase } from '@/lib/customSupabaseClient';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const Subcontractors = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [subcontractors, setSubcontractors] = useState([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingSubcontractor, setEditingSubcontractor] = useState(null);
  const [view, setView] = useState('grid'); 

  const fetchSubcontractors = useCallback(async () => {
    const { data, error } = await supabase.from('subcontractors').select('*').order('created_at', { ascending: false });
    if (error) {
      toast({ title: 'Chyba při načítání subdodavatelů', variant: 'destructive' });
    } else {
      setSubcontractors(data);
    }
  }, [toast]);

  useEffect(() => {
    fetchSubcontractors();
  }, [fetchSubcontractors]);

  const handleSave = async (data) => {
    if (editingSubcontractor) {
      const { error } = await supabase.from('subcontractors').update(data).eq('id', editingSubcontractor.id);
      if (error) { toast({ title: 'Chyba při úpravě subdodavatele', variant: 'destructive' }); }
      else { toast({ title: "✅ Subdodavatel upraven!" }); }
    } else {
      const { error } = await supabase.from('subcontractors').insert([data]);
      if (error) { toast({ title: 'Chyba při přidávání subdodavatele', variant: 'destructive' }); }
      else { toast({ title: "✅ Subdodavatel přidán!" }); }
    }
    fetchSubcontractors();
    setIsDialogOpen(false);
    setEditingSubcontractor(null);
  };
  
  const handleDelete = async (id) => {
      const { error } = await supabase.from('subcontractors').delete().eq('id', id);
      if (error) { toast({ title: 'Chyba při mazání subdodavatele', variant: 'destructive', description: "Nejprve ho odstraňte ze všech projektů." }); }
      else { toast({ title: "🗑️ Subdodavatel smazán." }); fetchSubcontractors(); }
  };

  const handleOpenDialog = (subcontractor = null) => {
    setEditingSubcontractor(subcontractor);
    setIsDialogOpen(true);
  };
  
  const renderActions = (sub) => (
    <div className="flex justify-end items-center">
        <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); handleOpenDialog(sub); }}>
            <Edit className="w-4 h-4" />
        </Button>
         <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="icon" onClick={(e) => e.stopPropagation()}>
                <Trash2 className="w-4 h-4 text-red-500" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Opravdu smazat subdodavatele?</AlertDialogTitle>
                <AlertDialogDescription>Tato akce je nevratná. Všechna data spojená s tímto subdodavatelem budou smazána.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Zrušit</AlertDialogCancel>
                <AlertDialogAction onClick={(e) => { e.stopPropagation(); handleDelete(sub.id); }} className="bg-red-600 hover:bg-red-700">Smazat</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
    </div>
  );

  return (
    <div className="space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between"
      >
        <div>
          <h1 className="text-4xl font-bold gradient-text mb-2">Subdodavatelé</h1>
          <p className="text-muted-foreground">Správa subdodavatelů a jejich smluv</p>
        </div>
        <div className="flex items-center gap-4">
            <div className="flex items-center gap-1 p-1 bg-slate-200 rounded-lg">
                <Button size="icon" variant={view === 'grid' ? 'secondary' : 'ghost'} onClick={() => setView('grid')}>
                    <LayoutGrid className="w-5 h-5" />
                </Button>
                <Button size="icon" variant={view === 'table' ? 'secondary' : 'ghost'} onClick={() => setView('table')}>
                    <Rows className="w-5 h-5" />
                </Button>
            </div>
            <Button
              onClick={() => handleOpenDialog()}
              className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 shadow-lg"
            >
              <Plus className="w-4 h-4 mr-2" />
              Nový subdodavatel
            </Button>
        </div>
      </motion.div>

      {subcontractors.length > 0 ? (
        view === 'grid' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {subcontractors.map((sub, index) => (
              <motion.div
                key={sub.id}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: index * 0.05 }}
                className="glass-effect rounded-lg p-5 flex flex-col group"
              >
                <Link to={`/subcontractors/${sub.id}`} className="flex-grow block">
                  <div className="flex items-start gap-3 mb-4">
                    <div className="p-3 bg-gradient-to-br from-green-500 to-emerald-500 rounded-lg">
                      <Users className="w-5 h-5 text-white" />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-bold group-hover:text-purple-600 transition-colors">{sub.company_name}</h3>
                      <p className="text-sm text-muted-foreground">IČ: {sub.ico || 'N/A'}</p>
                    </div>
                  </div>

                  <div className="space-y-2 mb-4">
                     {sub.field_of_work && <div className="flex items-center gap-2 text-sm"><Briefcase className="w-4 h-4 text-muted-foreground" /><span>{sub.field_of_work}</span></div>}
                    {sub.phone && <div className="flex items-center gap-2 text-sm"><Phone className="w-4 h-4 text-muted-foreground" /><span>{sub.phone}</span></div>}
                    {sub.email && <div className="flex items-center gap-2 text-sm"><Mail className="w-4 h-4 text-muted-foreground" /><span>{sub.email}</span></div>}
                    <div className="flex items-center gap-2">
                      <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />
                      <span className="text-sm font-medium">{sub.rating || 'N/A'}</span>
                    </div>
                  </div>
                </Link>
                {renderActions(sub)}
              </motion.div>
            ))}
          </div>
        ) : (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="glass-effect rounded-xl overflow-hidden">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Firma</TableHead>
                        <TableHead>Obor</TableHead>
                        <TableHead>Kontakt</TableHead>
                        <TableHead>Hodnocení</TableHead>
                        <TableHead className="text-right">Akce</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {subcontractors.map(sub => (
                        <TableRow key={sub.id} className="cursor-pointer" onClick={() => navigate(`/subcontractors/${sub.id}`)}>
                            <TableCell className="font-bold">{sub.company_name}</TableCell>
                            <TableCell>{sub.field_of_work || 'N/A'}</TableCell>
                            <TableCell>
                                <div>{sub.email}</div>
                                <div className="text-xs text-muted-foreground">{sub.phone}</div>
                            </TableCell>
                            <TableCell>
                                <div className="flex items-center gap-1">
                                    <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />
                                    {sub.rating || 'N/A'}
                                </div>
                            </TableCell>
                            <TableCell className="text-right">
                                {renderActions(sub)}
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
          </motion.div>
        )
      ) : (
        <div className="glass-effect rounded-xl p-12 text-center">
          <Users className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">Zatím žádní subdodavatelé</p>
        </div>
      )}

      <SubcontractorDialog
        isOpen={isDialogOpen}
        onClose={() => { setIsDialogOpen(false); setEditingSubcontractor(null); }}
        onSave={handleSave}
        subcontractor={editingSubcontractor}
      />
    </div>
  );
};

export default Subcontractors;