import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Users, UserPlus, KeyRound, UserCog, Briefcase, CheckCircle2, Edit, Trash2, Search, RefreshCw, Mail, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { Dialog } from '@/components/ui/dialog';
import { FormDialogBody, FormDialogContent, FormDialogFooter, FormDialogHeader } from '@/components/ui/form-dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { supabase } from '@/lib/customSupabaseClient';
import { logAction } from '@/lib/logger';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import PageHeader from '@/components/ui/page-header';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

const capitalizeFirstLetter = (string) => {
    if (!string) return '';
    return string.charAt(0).toUpperCase() + string.slice(1);
}

const UserManagement = () => {
    const { toast } = useToast();
    const navigate = useNavigate();
    const { user: currentUser, isAdmin } = useAuth();
    const [users, setUsers] = useState([]);
    const [roles, setRoles] = useState([]);
    const [isUserDialogOpen, setIsUserDialogOpen] = useState(false);
    const [editingUser, setEditingUser] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [roleFilter, setRoleFilter] = useState('all');
    const [accountFilter, setAccountFilter] = useState('all');

    const invokeFunction = async (functionName, payload) => {
        return await supabase.functions.invoke(functionName, {
            body: payload,
        });
    };

    const fetchUsers = useCallback(async () => {
        const { data, error } = await invokeFunction('manage-users', {
            action: 'list_users'
        });
        
        if (error) {
            toast({ title: "Chyba při načítání uživatelů", description: error.message, variant: "destructive" });
        } else if (data && data.error) {
            toast({ title: "Chyba na straně serveru", description: data.error, variant: "destructive" });
        }
        else {
            setUsers(data.users || []);
            setRoles(data.roles || []);
        }
    }, [toast]);

    useEffect(() => {
        fetchUsers();
    }, [fetchUsers]);
    
    const handleRoleChange = async (userId, newRole) => {
        if (!newRole) return;
         const { data, error } = await invokeFunction('manage-users', {
            action: 'update_user_role', payload: { userId, role: newRole }
        });

        if (error || (data && data.error)) {
            toast({ title: "Chyba při změně přístupové role", description: data?.error || error?.message || 'Neznámá chyba', variant: "destructive" });
        } else {
            toast({ title: "✅ Přístupová role uživatele změněna!" });
            fetchUsers();
        }
    };

    const handleNameChange = async (userId, newName) => {
        const { error } = await invokeFunction('manage-users', {
            action: 'update_user_name', payload: { userId, full_name: newName }
        });

        if (error) {
            toast({ title: "Chyba při změně jména", description: error.message, variant: "destructive" });
        } else {
            toast({ title: "✅ Jméno uživatele změněno!" });
            setEditingUser(null);
            fetchUsers();
        }
    };
    
    const handleResetPassword = async (email) => {
         const { error } = await invokeFunction('manage-users', {
            action: 'reset_password', payload: { email }
        });

        if (error) {
            toast({ title: "Chyba při resetování hesla", description: error.message, variant: "destructive" });
        } else {
            toast({ title: "🔑 Odkaz pro obnovu hesla byl odeslán." });
        }
    };
    
    const handleCreateMember = async (user) => {
        const { id, email, user_metadata } = user;
        const fullName = user_metadata?.full_name;
        
        if (!fullName) {
            toast({ title: "Chyba", description: "Uživatel nemá nastavené celé jméno. Prosím, doplňte jméno před vytvořením zaměstnance.", variant: "destructive" });
            return;
        }

        const { data, error } = await invokeFunction('manage-users', {
            action: 'create_member_from_user', payload: { userId: id, email, full_name: fullName }
        });
        
        if (error || (data && data.error)) {
            toast({ title: "Chyba", description: data?.error || error.message, variant: "destructive" });
        } else {
            toast({ title: "Uživatel byl vytvořen jako zaměstnanec" });
            fetchUsers();
            navigate('/members');
        }
    }

    const handleDeleteUser = async (userToDelete) => {
        const { error } = await invokeFunction('manage-users', {
            action: 'delete_user_nopass',
            payload: { userId: userToDelete.id }
        });

        if (error) {
            toast({ title: "Chyba při mazání uživatele", description: error.message, variant: "destructive" });
        } else {
            toast({ title: "🗑️ Uživatel smazán!" });
            await logAction('delete_user', { deleted_user_email: userToDelete.email });
            fetchUsers();
        }
    };

    const filteredUsers = (users || []).filter((user) => {
        const role = user.user_metadata?.role || '';
        const query = searchTerm.trim().toLowerCase();
        const matchesSearch = !query ||
            (user.user_metadata?.full_name || '').toLowerCase().includes(query) ||
            (user.email || '').toLowerCase().includes(query);
        const matchesRole = roleFilter === 'all' || (roleFilter === 'none' ? !role : role === roleFilter);
        const matchesAccount =
            accountFilter === 'all' ||
            (accountFilter === 'employees' && user.is_member) ||
            (accountFilter === 'without_employee' && !user.is_member) ||
            (accountFilter === 'without_role' && !role);
        return matchesSearch && matchesRole && matchesAccount;
    });

    const adminCount = (users || []).filter(user => user.user_metadata?.role === 'admin').length;
    const memberCount = (users || []).filter(user => user.is_member).length;
    const usersWithoutRole = (users || []).filter(user => !user.user_metadata?.role).length;
    const usersWithoutEmployee = (users || []).filter(user => !user.is_member).length;

    const summaryCards = [
        { key: 'all', label: 'Uživatelé', value: users.length, icon: Users, className: 'bg-blue-50 text-blue-600' },
        { key: 'employees', label: 'Propojeno se zaměstnancem', value: memberCount, icon: Briefcase, className: 'bg-green-50 text-green-600' },
        { key: 'without_employee', label: 'Bez zaměstnance', value: usersWithoutEmployee, icon: UserPlus, className: 'bg-amber-50 text-amber-600' },
        { key: 'without_role', label: 'Bez přístupové role', value: usersWithoutRole, icon: KeyRound, className: 'bg-red-50 text-red-600' },
    ];

    return (
        <div className="space-y-6">
            <PageHeader
                icon={UserCog}
                title="Správa uživatelů"
                description="Správa účtů, přístupových rolí a propojení na zaměstnance."
                actions={
                    <>
                        <Button variant="outline" onClick={fetchUsers} className="w-full sm:w-auto">
                            <RefreshCw className="w-4 h-4 mr-2" /> Aktualizovat
                        </Button>
                        <Button onClick={() => setIsUserDialogOpen(true)} disabled={!isAdmin} className="w-full sm:w-auto">
                            <UserPlus className="w-4 h-4 mr-2" /> Pozvat uživatele
                        </Button>
                    </>
                }
            />
            <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                {summaryCards.map((card) => {
                    const Icon = card.icon;
                    const active = accountFilter === card.key;
                    return (
                        <button
                            key={card.key}
                            type="button"
                            onClick={() => setAccountFilter(accountFilter === card.key ? 'all' : card.key)}
                            className={cn(
                                'app-surface p-4 text-left transition-all hover:border-primary/30 hover:shadow-sm',
                                active && 'border-primary/40 bg-primary/[0.03] ring-1 ring-primary/15'
                            )}
                        >
                            <div className="flex items-center gap-3">
                                <div className={cn('flex h-10 w-10 items-center justify-center rounded-lg', card.className)}>
                                    <Icon className="h-5 w-5" />
                                </div>
                                <div>
                                    <p className="text-sm text-muted-foreground">{card.label}</p>
                                    <p className="text-2xl font-semibold">{card.value}</p>
                                </div>
                            </div>
                        </button>
                    );
                })}
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div className="app-surface p-4">
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-50 text-purple-600">
                            <Shield className="h-5 w-5" />
                        </div>
                        <div>
                            <p className="text-sm text-muted-foreground">Administrátoři</p>
                            <p className="text-2xl font-semibold">{adminCount}</p>
                        </div>
                    </div>
                </div>
                <div className="app-surface p-4 md:col-span-2">
                    <p className="text-sm font-medium text-slate-900">Rozdíl mezi účtem a zaměstnancem</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Účet řeší přihlášení a přístupovou roli. Zaměstnanec drží profil pro docházku, výplaty, projekty a osobní nastavení.
                    </p>
                </div>
            </div>

            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="app-surface overflow-hidden"
            >
                <div className="border-b bg-slate-50/60 p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                            <h2 className="text-lg font-semibold">Účty v portálu</h2>
                            <p className="text-sm text-muted-foreground">
                                Zobrazeno {filteredUsers.length} z {users.length} účtů. Nastavte přístupovou roli nebo propojení na zaměstnance.
                            </p>
                        </div>
                        <div className="flex flex-col gap-2 sm:flex-row">
                            <div className="relative w-full sm:w-80">
                                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                                <Input
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    placeholder="Hledat jméno nebo e-mail..."
                                    className="pl-8"
                                />
                            </div>
                            <Select value={roleFilter} onValueChange={setRoleFilter}>
                                <SelectTrigger className="w-full sm:w-48">
                                    <SelectValue placeholder="Role" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">Všechny přístupové role</SelectItem>
                                    {roles.map((role) => (
                                        <SelectItem key={role} value={role}>{capitalizeFirstLetter(role)}</SelectItem>
                                    ))}
                                    <SelectItem value="none">Bez přístupové role</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                </div>

                <div className="divide-y">
                    {filteredUsers.length > 0 ? filteredUsers.map(user => (
                        <div key={user.id} className="grid gap-4 bg-white p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                            <div className="min-w-0">
                                {editingUser === user.id ? (
                                    <Input 
                                        defaultValue={user.user_metadata?.full_name || ''}
                                        onBlur={(e) => handleNameChange(user.id, e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && handleNameChange(user.id, e.target.value)}
                                        autoFocus
                                        className="mb-2 max-w-md text-lg font-semibold"
                                        disabled={!isAdmin}
                                    />
                                ) : (
                                    <div className="flex min-w-0 items-center gap-2">
                                        <p className="truncate text-lg font-semibold">{user.user_metadata?.full_name || 'Beze jména'}</p>
                                        <Button variant="ghost" size="icon" aria-label={`Upravit uzivatele ${user.email || user.id}`} className="h-7 w-7 shrink-0" onClick={() => setEditingUser(user.id)} disabled={!isAdmin}>
                                            <Edit className="w-3.5 h-3.5"/>
                                        </Button>
                                    </div>
                                )}
                                <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                                    <span className="inline-flex items-center gap-1.5">
                                        <Mail className="h-3.5 w-3.5" />
                                        {user.email}
                                    </span>
                                    <span>Vytvořen: {new Date(user.created_at).toLocaleDateString('cs-CZ')}</span>
                                </div>
                                <div className="mt-3 flex flex-wrap items-center gap-2">
                                    <Badge variant={user.user_metadata?.role === 'admin' ? 'info' : 'secondary'} className="capitalize">
                                      {user.user_metadata?.role || 'Bez přístupové role'}
                                    </Badge>
                                    {user.is_member && (
                                        <Badge variant="success" className="gap-1">
                                            <CheckCircle2 className="w-3 h-3" />
                                            Zaměstnanec
                                        </Badge>
                                    )}
                                    {user.id === currentUser.id && <Badge variant="outline">Aktuální účet</Badge>}
                                </div>
                            </div>
                             <div className="flex w-full flex-col flex-wrap gap-2 sm:flex-row lg:w-auto lg:justify-end">
                                <Button 
                                    variant="outline" 
                                    size="sm" 
                                    onClick={() => handleCreateMember(user)}
                                    disabled={user.is_member || !isAdmin}
                                    className="w-full sm:w-auto"
                                >
                                    <Briefcase className="w-4 h-4 mr-2"/> 
                                    {user.is_member ? 'Je zaměstnanec' : 'Vytvořit zaměstnance'}
                                </Button>
                                <Select
                                    value={user.user_metadata?.role || ''}
                                    onValueChange={(value) => handleRoleChange(user.id, value)}
                                    disabled={!isAdmin || user.id === currentUser.id}
                                >
                                    <SelectTrigger className="w-full sm:w-44">
                                        <SelectValue placeholder={user.user_metadata?.role ? "Změnit přístupovou roli" : "Žádná přístupová role"} />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {roles.map((role) => (
                                            <SelectItem key={role} value={role}>{capitalizeFirstLetter(role)}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <Button variant="outline" size="sm" onClick={() => handleResetPassword(user.email)} disabled={!isAdmin} className="w-full sm:w-auto">
                                    <KeyRound className="w-4 h-4 mr-2" /> Reset hesla
                                </Button>
                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <Button variant="destructive" size="sm" disabled={!isAdmin || user.id === currentUser.id} className="w-full sm:w-auto">
                                      <Trash2 className="w-4 h-4 mr-2" /> Smazat
                                    </Button>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>Opravdu chcete smazat uživatele?</AlertDialogTitle>
                                      <AlertDialogDescription>
                                        Tato akce je nevratná. Uživatel <span className="font-bold">{user.user_metadata?.full_name || user.email}</span> bude trvale smazán.
                                      </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel>Zrušit</AlertDialogCancel>
                                      <AlertDialogAction onClick={() => handleDeleteUser(user)}>Ano, smazat</AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                             </div>
                        </div>
                    )) : (
                        <div className="p-10 text-center">
                            <Users className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
                            <div className="font-medium">Žádní uživatelé nenalezeni</div>
                            <div className="text-sm text-muted-foreground">Zkuste upravit hledání nebo filtr role.</div>
                        </div>
                    )}
                </div>
            </motion.div>
            <NewUserDialog isOpen={isUserDialogOpen} onClose={() => setIsUserDialogOpen(false)} onUserCreated={fetchUsers} invokeFunction={invokeFunction} />
        </div>
    );
};

const NewUserDialog = ({ isOpen, onClose, onUserCreated, invokeFunction }) => {
    const { toast } = useToast();
    const [email, setEmail] = useState('');
    const [fullName, setFullName] = useState('');

    const handleCreateUser = async (e) => {
        e.preventDefault();
        if (!email || !fullName) {
            toast({ title: "Vyplňte prosím všechna pole.", variant: "destructive" });
            return;
        }

        const { data, error } = await invokeFunction('manage-users', {
            action: 'invite_user',
            payload: { email, full_name: fullName },
        });

        if (error || (data && data.error)) {
            toast({ title: "Chyba při vytváření uživatele", description: data?.error || error?.message || 'Neznámá chyba', variant: "destructive" });
        } else {
            toast({ title: "✅ Pozvánka pro uživatele odeslána!" });
            await logAction('invite_user', { email });
            setEmail('');
            setFullName('');
            onUserCreated();
            onClose();
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <FormDialogContent size="sm">
                <FormDialogHeader
                    icon={UserPlus}
                    title="Pozvat nového uživatele"
                    description='Uživatel obdrží pozvánku na zadaný e-mail a bude si moci nastavit heslo. Výchozí přístupová role je "uživatel".'
                />
                <form onSubmit={handleCreateUser} className="flex min-h-0 flex-1 flex-col">
                    <FormDialogBody className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="fullName">Celé jméno</Label>
                        <Input id="fullName" type="text" value={fullName} onChange={e => setFullName(e.target.value)} required />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="email">Email</Label>
                        <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} required />
                    </div>
                    </FormDialogBody>
                    <FormDialogFooter>
                        <Button type="button" variant="outline" onClick={onClose}>Zrušit</Button>
                        <Button type="submit">Odeslat pozvánku</Button>
                    </FormDialogFooter>
                </form>
            </FormDialogContent>
        </Dialog>
    );
};

export default UserManagement;
