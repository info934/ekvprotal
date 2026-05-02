import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Users, UserPlus, KeyRound, UserCog, Briefcase, CheckCircle2, Edit, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/use-toast';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { supabase } from '@/lib/customSupabaseClient';
import { logAction } from '@/lib/logger';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import PageHeader from '@/components/ui/page-header';

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
            toast({ title: "Chyba při změně role", description: data?.error || error?.message || 'Neznámá chyba', variant: "destructive" });
        } else {
            toast({ title: "✅ Role uživatele změněna!" });
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
            toast({ title: "Chyba", description: "Uživatel nemá nastavené celé jméno. Prosím, doplňte jméno před vytvořením projektanta.", variant: "destructive" });
            return;
        }

        const { data, error } = await invokeFunction('manage-users', {
            action: 'create_member_from_user', payload: { userId: id, email, full_name: fullName }
        });
        
        if (error || (data && data.error)) {
            toast({ title: "Chyba", description: data?.error || error.message, variant: "destructive" });
        } else {
            toast({ title: "✅ Uživatel byl vytvořen jako projektant!" });
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

    return (
        <div className="space-y-8">
            <PageHeader
                icon={UserCog}
                title="Správa uživatelů"
                description="Správa přístupů, rolí a účtů v portálu"
                actions={
                    <Button onClick={() => setIsUserDialogOpen(true)} disabled={!isAdmin} className="w-full sm:w-auto">
                        <UserPlus className="w-4 h-4 mr-2" /> Nový uživatel
                    </Button>
                }
            />
            <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
                <div className="hidden">
                     <h1 className="text-4xl font-bold gradient-text mb-2 flex items-center gap-3">
                        <UserCog />
                        Správa uživatelů
                    </h1>
                     <Button onClick={() => setIsUserDialogOpen(true)} disabled={!isAdmin} className="w-full sm:w-auto">
                        <UserPlus className="w-4 h-4 mr-2" /> Nový uživatel
                    </Button>
                </div>
                <p className="text-muted-foreground">Správa přístupů, rolí a účtů v portálu</p>
            </motion.div>

            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="glass-effect rounded-xl p-6"
            >
                <div className="space-y-4">
                    {(users || []).map(user => (
                        <div key={user.id} className="p-4 bg-white rounded-lg border flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                            <div>
                                {editingUser === user.id ? (
                                    <Input 
                                        defaultValue={user.user_metadata?.full_name || ''}
                                        onBlur={(e) => handleNameChange(user.id, e.target.value)}
                                        onKeyPress={(e) => e.key === 'Enter' && handleNameChange(user.id, e.target.value)}
                                        autoFocus
                                        className="text-lg font-semibold"
                                        disabled={!isAdmin}
                                    />
                                ) : (
                                    <p className="font-semibold text-lg flex items-center gap-2">
                                        {user.user_metadata?.full_name || 'Beze jména'}
                                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setEditingUser(user.id)} disabled={!isAdmin}><Edit className="w-3 h-3"/></Button>
                                    </p>
                                )}
                                <p className="text-sm text-muted-foreground">{user.email}</p>
                                <p className="text-xs text-muted-foreground">Vytvořen: {new Date(user.created_at).toLocaleDateString('cs-CZ')}</p>
                                <div className="mt-2 flex items-center gap-2">
                                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${user.user_metadata?.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-slate-100 text-slate-700'}`}>
                                      {user.user_metadata?.role || 'Bez role'}
                                    </span>
                                    {user.is_member && (
                                        <span className="flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full bg-green-100 text-green-700">
                                            <CheckCircle2 className="w-3 h-3" />
                                            Projektant
                                        </span>
                                    )}
                                </div>
                            </div>
                             <div className="flex flex-col sm:flex-row flex-wrap gap-2 w-full md:w-auto">
                                <Button 
                                    variant="outline" 
                                    size="sm" 
                                    onClick={() => handleCreateMember(user)}
                                    disabled={user.is_member || !isAdmin}
                                    className="w-full sm:w-auto"
                                >
                                    <Briefcase className="w-4 h-4 mr-2"/> 
                                    {user.is_member ? 'Je projektant' : 'Vytvořit projektanta'}
                                </Button>
                                <select 
                                    value={user.user_metadata?.role || ''}
                                    onChange={(e) => handleRoleChange(user.id, e.target.value)}
                                    className="px-3 py-1.5 border rounded-md text-sm w-full sm:w-auto"
                                    disabled={!isAdmin || user.id === currentUser.id}
                                >
                                    <option value="" disabled>{user.user_metadata?.role ? "Změnit roli" : "Žádná role"}</option>
                                    {roles.map((role) => (
                                        <option key={role} value={role}>{capitalizeFirstLetter(role)}</option>
                                    ))}
                                </select>
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
                    ))}
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
        <AlertDialog open={isOpen} onOpenChange={onClose}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Pozvat nového uživatele</AlertDialogTitle>
                    <AlertDialogDescription>
                        Uživatel obdrží pozvánku na zadaný e-mail a bude si moci nastavit heslo. Výchozí role je "uživatel".
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <form onSubmit={handleCreateUser} className="space-y-4">
                    <div>
                        <label htmlFor="fullName" className="block text-sm font-medium mb-1">Celé jméno</label>
                        <Input id="fullName" type="text" value={fullName} onChange={e => setFullName(e.target.value)} required />
                    </div>
                    <div>
                        <label htmlFor="email" className="block text-sm font-medium mb-1">Email</label>
                        <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} required />
                    </div>
                    <AlertDialogFooter>
                        <AlertDialogCancel type="button">Zrušit</AlertDialogCancel>
                        <Button type="submit">Odeslat pozvánku</Button>
                    </AlertDialogFooter>
                </form>
            </AlertDialogContent>
        </AlertDialog>
    );
};

export default UserManagement;
