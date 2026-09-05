import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Plus, Edit2, Trash2, Contact, Mail, Phone, Search, AlertTriangle, Loader2 } from 'lucide-react';
import ProjectContactDialog from '@/components/ProjectContactDialog';
import { fetchAllListRows } from '@/lib/listWorkspaceState';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';

const ProjectContacts = ({ projectId }) => {
    const { toast } = useToast();
    const { hasPermission, user } = useAuth();
    const [state, setState] = useState({ scope: null, rows: [], loading: true, error: null });
    const [search, setSearch] = useState('');
    const [isContactDialogOpen, setIsContactDialogOpen] = useState(false);
    const [editingContact, setEditingContact] = useState(null);
    const [contactToDelete, setContactToDelete] = useState(null);
    const [saving, setSaving] = useState(false);
    const mutationLock = useRef(false);
    const requestRef = useRef(null);
    const scope = `${user?.id || ''}:${projectId}`;
    const currentScope = useRef(scope); currentScope.current = scope;
    const canEdit = hasPermission('projects', 'can_edit');

    const fetchData = useCallback(async () => {
        requestRef.current?.abort();
        const controller = new AbortController();
        requestRef.current = controller;
        setState({ scope, rows: [], loading: true, error: null });
        try {
            const rows = await fetchAllListRows((from, to) => supabase.from('project_contacts').select('*').eq('project_id', projectId).order('name').order('id').range(from, to).abortSignal(controller.signal));
            if (!controller.signal.aborted) setState({ scope, rows, loading: false, error: null });
        } catch (error) {
            if (!controller.signal.aborted) setState({ scope, rows: [], loading: false, error: error.message });
        }
    }, [projectId, scope]);

    useEffect(() => {
        setSearch(''); setIsContactDialogOpen(false); setEditingContact(null); setContactToDelete(null);
        fetchData();
        return () => requestRef.current?.abort();
    }, [fetchData]);

    const handleSaveContact = async (formData) => {
        if (!canEdit || mutationLock.current) return;
        mutationLock.current = true; setSaving(true);
        try {
            const dataToSave = { name: formData.name.trim(), role: formData.role?.trim() || null, email: formData.email?.trim() || null, phone: formData.phone?.trim() || null, project_id: projectId };
            if (!dataToSave.name) throw new Error('Vyplňte jméno kontaktu.');
            const query = editingContact ? supabase.from('project_contacts').update(dataToSave).eq('id', editingContact.id).eq('project_id', projectId) : supabase.from('project_contacts').insert(dataToSave);
            const { data, error } = await query.select('id').single();
            if (error) throw error;
            if (!data?.id) throw new Error('Uložení kontaktu se nepodařilo potvrdit.');
            if (currentScope.current !== scope) return;
            toast({ title: 'Kontakt uložen' });
            setIsContactDialogOpen(false); setEditingContact(null);
            await fetchData();
        } catch (error) {
            if (currentScope.current === scope) toast({ title: 'Kontakt se nepodařilo uložit', variant: 'destructive', description: error.message });
        } finally { mutationLock.current = false; setSaving(false); }
    };

    const handleDeleteContact = async (event) => {
        event.preventDefault();
        if (!contactToDelete || !canEdit || mutationLock.current) return;
        mutationLock.current = true; setSaving(true);
        try {
            const { data, error } = await supabase.from('project_contacts').delete().eq('id', contactToDelete.id).eq('project_id', projectId).select('id').single();
            if (error) throw error;
            if (!data?.id) throw new Error('Smazání kontaktu se nepodařilo potvrdit.');
            if (currentScope.current !== scope) return;
            toast({ title: 'Kontakt smazán' }); setContactToDelete(null); await fetchData();
        } catch (error) {
            if (currentScope.current === scope) toast({ title: 'Kontakt se nepodařilo smazat', variant: 'destructive', description: error.message });
        } finally { mutationLock.current = false; setSaving(false); }
    };

    const current = state.scope === scope ? state : { rows: [], loading: true, error: null };
    const contacts = useMemo(() => {
        const query = search.trim().toLocaleLowerCase('cs-CZ');
        return (state.scope === scope ? state.rows : []).filter(contact => [contact.name, contact.role, contact.email, contact.phone].some(value => String(value || '').toLocaleLowerCase('cs-CZ').includes(query)));
    }, [scope, search, state]);
    const openNewDialog = () => { setEditingContact(null); setIsContactDialogOpen(true); };

    return <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
            <div><h2 className="text-xl font-semibold">Externí kontakty</h2><p className="mt-1 text-sm text-muted-foreground">Kontaktní osoby investora, úřadů a dalších partnerů projektu.</p></div>
            {canEdit && <Button onClick={openNewDialog} disabled={saving}><Plus className="mr-2 h-4 w-4" />Přidat kontakt</Button>}
        </div>
        <div className="relative max-w-lg"><Search className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" /><Input className="pl-9" aria-label="Hledat externí kontakt" placeholder="Hledat jméno, roli, e-mail nebo telefon…" value={search} onChange={event => setSearch(event.target.value)} /></div>
        {current.loading ? <div role="status" className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Načítám kontakty…</div> : current.error ? <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-5"><p className="flex items-center gap-2 font-medium"><AlertTriangle className="h-4 w-4" />Kontakty se nepodařilo načíst</p><p className="mt-1 text-sm">{current.error}</p><Button variant="outline" onClick={fetchData} className="mt-3">Zkusit znovu</Button></div> : contacts.length ? <div className="grid gap-4 lg:grid-cols-2">
            {contacts.map(contact => <Card key={contact.id}><CardContent className="p-5">
                <div className="flex min-w-0 items-start justify-between gap-3"><div className="min-w-0"><h3 className="break-words font-semibold">{contact.name}</h3><p className="mt-1 break-words text-sm text-muted-foreground">{contact.role || 'Role není doplněna'}</p></div>
                    {canEdit && <div className="flex shrink-0"><Button variant="ghost" size="icon" disabled={saving} aria-label={`Upravit kontakt ${contact.name}`} onClick={() => { setEditingContact(contact); setIsContactDialogOpen(true); }}><Edit2 className="h-4 w-4" /></Button><Button variant="ghost" size="icon" disabled={saving} aria-label={`Smazat kontakt ${contact.name}`} onClick={() => setContactToDelete(contact)}><Trash2 className="h-4 w-4 text-red-600" /></Button></div>}
                </div>
                <div className="mt-4 space-y-2 text-sm">
                    {contact.email && <a href={`mailto:${contact.email}`} className="flex min-h-9 items-center gap-2 break-all text-primary hover:underline"><Mail className="h-4 w-4 shrink-0" />{contact.email}</a>}
                    {contact.phone && <a href={`tel:${contact.phone}`} className="flex min-h-9 items-center gap-2 break-all text-primary hover:underline"><Phone className="h-4 w-4 shrink-0" />{contact.phone}</a>}
                    {!contact.email && !contact.phone && <p className="text-muted-foreground">E-mail ani telefon nejsou doplněné.</p>}
                </div>
            </CardContent></Card>)}
        </div> : <div className="rounded-xl border border-dashed p-8 text-center"><Contact className="mx-auto mb-3 h-8 w-8 text-muted-foreground" /><h3 className="font-semibold">{search ? 'Žádný kontakt neodpovídá hledání' : 'Zatím bez externích kontaktů'}</h3><p className="mt-2 text-sm text-muted-foreground">{search ? 'Zkuste jiné jméno nebo hledání vymažte.' : 'Přidejte osoby, se kterými komunikujete mimo projektový tým.'}</p>{search && <Button className="mt-3" variant="outline" onClick={() => setSearch('')}>Vymazat hledání</Button>}</div>}
        {canEdit && <ProjectContactDialog isOpen={isContactDialogOpen} onClose={() => { if (!saving) setIsContactDialogOpen(false); }} onSave={handleSaveContact} contact={editingContact} projectId={projectId} />}
        <AlertDialog open={!!contactToDelete} onOpenChange={open => { if (!open && !saving) setContactToDelete(null); }}>
            <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Smazat externí kontakt?</AlertDialogTitle><AlertDialogDescription>Kontakt „{contactToDelete?.name}“ bude odebrán z tohoto projektu.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={saving}>Zrušit</AlertDialogCancel><AlertDialogAction disabled={saving} onClick={handleDeleteContact} className="bg-destructive hover:bg-destructive/90">{saving ? 'Mažu…' : 'Smazat kontakt'}</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
        </AlertDialog>
    </div>;
};
export default ProjectContacts;
