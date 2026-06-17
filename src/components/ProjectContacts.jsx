import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Edit2, Trash2, Contact, Users, Briefcase } from 'lucide-react';
import ProjectContactDialog from '@/components/ProjectContactDialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";


const DetailSection = ({ title, icon: Icon, children, actions, className = "" }) => (
    <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className={`bg-white rounded-xl border shadow-sm ${className}`}
    >
        <div className="p-6 border-b bg-gradient-to-r from-slate-50 to-slate-100 rounded-t-xl">
            <div className="flex justify-between items-center">
                <h3 className="text-xl font-bold flex items-center gap-3 text-slate-800">
                    <Icon className="w-6 h-6 text-primary" />
                    {title}
                </h3>
                {actions && <div className="flex gap-2">{actions}</div>}
            </div>
        </div>
        <div className="p-6">
            <div className="space-y-4">{children}</div>
        </div>
    </motion.div>
);

const ProjectContacts = ({ projectId }) => {
    const { toast } = useToast();
    const { hasPermission } = useAuth();
    const [externalContacts, setExternalContacts] = useState([]);
    const [teamMembers, setTeamMembers] = useState([]);
    const [subcontractors, setSubcontractors] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isContactDialogOpen, setIsContactDialogOpen] = useState(false);
    const [editingContact, setEditingContact] = useState(null);
    const [contactToDelete, setContactToDelete] = useState(null);

    const canEdit = useMemo(() => hasPermission('projects', 'can_edit'), [hasPermission]);

    const fetchData = useCallback(async () => {
        setLoading(true);

        const [contactsRes, membersRes, subcontractorsRes] = await Promise.all([
            supabase.from('project_contacts').select('*').eq('project_id', projectId),
            supabase.rpc('list_project_members_safe', { p_project_id: projectId }),
            supabase.rpc('list_project_subcontractors_safe', { p_project_id: projectId })
        ]);

        if (contactsRes.error) {
            toast({ title: 'Chyba při načítání externích kontaktů', variant: 'destructive', description: contactsRes.error.message });
        } else {
            setExternalContacts(contactsRes.data);
        }

        if (membersRes.error) {
            toast({ title: 'Chyba při načítání týmu', variant: 'destructive', description: membersRes.error.message });
        } else {
            setTeamMembers(membersRes.data.map(m => ({
                id: m.member?.id || m.member_id,
                name: m.member?.name || 'Člen týmu',
                role: m.member?.role?.name || 'Člen týmu',
                email: m.member?.email,
                phone: m.member?.phone,
                type: 'team'
            })));
        }

        if (subcontractorsRes.error) {
            toast({ title: 'Chyba při načítání subdodavatelů', variant: 'destructive', description: subcontractorsRes.error.message });
        } else {
            setSubcontractors(subcontractorsRes.data.map(s => ({
                id: s.subject_id,
                name: s.subject?.contact_person || s.subject?.name,
                role: `Subdodavatel (${s.subject?.name})`,
                email: s.subject?.email,
                phone: s.subject?.phone,
                type: 'subcontractor'
            })));
        }

        setLoading(false);
    }, [projectId, toast]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const handleSaveContact = async (formData) => {
        const dataToSave = { ...formData, project_id: projectId };
        if (editingContact && editingContact.type === 'external') {
            dataToSave.id = editingContact.id;
        }

        const { error } = await supabase.from('project_contacts').upsert(dataToSave);

        if (error) {
            toast({ title: 'Chyba při ukládání kontaktu', variant: 'destructive', description: error.message });
        } else {
            toast({ title: '✅ Kontakt uložen' });
            setIsContactDialogOpen(false);
            setEditingContact(null);
            fetchData();
        }
    };

    const handleDeleteContact = async () => {
        if (!contactToDelete) return;
        const { error } = await supabase.from('project_contacts').delete().eq('id', contactToDelete.id);
        if (error) {
            toast({ title: 'Chyba při mazání kontaktu', variant: 'destructive', description: error.message });
        } else {
            toast({ title: '🗑️ Kontakt smazán' });
            fetchData();
        }
        setContactToDelete(null);
    };

    const openEditDialog = (contact) => {
        setEditingContact({ ...contact, type: 'external' });
        setIsContactDialogOpen(true);
    };

    const openNewDialog = () => {
        setEditingContact(null);
        setIsContactDialogOpen(true);
    };

    const allContacts = [...teamMembers, ...subcontractors, ...externalContacts.map(c => ({ ...c, type: 'external' }))];

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-2xl font-bold text-slate-800">Kontakty projektu</h2>
                    <p className="text-muted-foreground mt-1">Správa všech kontaktů souvisejících s projektem</p>
                </div>
                {canEdit && (
                    <Button onClick={openNewDialog} className="shadow-lg hover:shadow-xl transition-shadow">
                        <Plus className="w-4 h-4 mr-2" />
                        Přidat externí kontakt
                    </Button>
                )}
            </div>

            <DetailSection title="Všichni kontakty" icon={Contact}>
                {loading ? (
                    <div className="flex items-center justify-center py-12">
                        <div className="text-center">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
                            <p className="text-muted-foreground">Načítání kontaktů...</p>
                        </div>
                    </div>
                ) : allContacts.length > 0 ? (
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow className="bg-slate-50">
                                    <TableHead className="font-semibold text-slate-700">Typ</TableHead>
                                    <TableHead className="font-semibold text-slate-700">Jméno</TableHead>
                                    <TableHead className="font-semibold text-slate-700">Role / Firma</TableHead>
                                    <TableHead className="font-semibold text-slate-700">Email</TableHead>
                                    <TableHead className="font-semibold text-slate-700">Telefon</TableHead>
                                    {canEdit && <TableHead className="text-right font-semibold text-slate-700">Akce</TableHead>}
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {allContacts.map(contact => (
                                    <TableRow key={`${contact.type}-${contact.id}`} className="hover:bg-slate-50 transition-colors">
                                        <TableCell>
                                            <div className="flex items-center gap-2">
                                                {contact.type === 'team' && <Users className="w-5 h-5 text-blue-500" title="Člen týmu" />}
                                                {contact.type === 'subcontractor' && <Briefcase className="w-5 h-5 text-orange-500" title="Subdodavatel" />}
                                                {contact.type === 'external' && <Contact className="w-5 h-5 text-gray-500" title="Externí kontakt" />}
                                                <span className="text-sm font-medium text-slate-600">
                                                    {contact.type === 'team' && 'Tým'}
                                                    {contact.type === 'subcontractor' && 'Subdodavatel'}
                                                    {contact.type === 'external' && 'Externí'}
                                                </span>
                                            </div>
                                        </TableCell>
                                        <TableCell className="font-medium text-slate-800">{contact.name}</TableCell>
                                        <TableCell className="text-slate-600">{contact.role}</TableCell>
                                        <TableCell>
                                            {contact.email ? (
                                                <a href={`mailto:${contact.email}`} className="text-blue-600 hover:text-blue-800 hover:underline transition-colors">
                                                    {contact.email}
                                                </a>
                                            ) : (
                                                <span className="text-muted-foreground">-</span>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            {contact.phone ? (
                                                <a href={`tel:${contact.phone}`} className="text-blue-600 hover:text-blue-800 hover:underline transition-colors">
                                                    {contact.phone}
                                                </a>
                                            ) : (
                                                <span className="text-muted-foreground">-</span>
                                            )}
                                        </TableCell>
                                        {canEdit ? (
                                            <TableCell className="text-right">
                                                {contact.type === 'external' && (
                                                    <div className="flex justify-end gap-1">
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            onClick={() => openEditDialog(contact)}
                                                            className="hover:bg-blue-50 hover:text-blue-600"
                                                        >
                                                            <Edit2 className="w-4 h-4" />
                                                        </Button>
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            onClick={() => setContactToDelete(contact)}
                                                            className="hover:bg-red-50 hover:text-red-600"
                                                        >
                                                            <Trash2 className="w-4 h-4" />
                                                        </Button>
                                                    </div>
                                                )}
                                            </TableCell>
                                        ) : <TableCell />}
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                ) : (
                    <div className="text-center py-12">
                        <Contact className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                        <h3 className="text-lg font-semibold text-slate-800 mb-2">Žádné kontakty</h3>
                        <p className="text-muted-foreground mb-4">Zatím nebyly přidány žádné externí kontakty.</p>
                        {canEdit && (
                            <Button onClick={openNewDialog} variant="outline">
                                <Plus className="w-4 h-4 mr-2" />
                                Přidat první kontakt
                            </Button>
                        )}
                    </div>
                )}
            </DetailSection>

            {canEdit && (
                <ProjectContactDialog
                    isOpen={isContactDialogOpen}
                    onClose={() => setIsContactDialogOpen(false)}
                    onSave={handleSaveContact}
                    contact={editingContact}
                    projectId={projectId}
                />
            )}
            
            <AlertDialog open={!!contactToDelete} onOpenChange={() => setContactToDelete(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Opravdu smazat kontakt?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Chystáte se smazat kontakt "{contactToDelete?.name}". Tato akce je nevratná.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Zrušit</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDeleteContact} className="bg-destructive hover:bg-destructive/90">Smazat</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

export default ProjectContacts;
