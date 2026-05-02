import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Shield, Save, UserCog } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import PageHeader from '@/components/ui/page-header';

const modules = [
    { key: 'dashboard', name: 'Přehled' },
    { key: 'projects', name: 'Projekty' },
    { key: 'tasks', name: 'Úkoly' },
    { key: 'attendance', name: 'Docházka' },
    { key: 'documents', name: 'Dokumenty' },
    { key: 'subjects', name: 'Subjekty' },
    { key: 'engineering', name: 'Inženýring' },
    { key: 'members', name: 'Členové' },
    { key: 'payouts', name: 'Výplaty' },
    { key: 'reports', name: 'Reporty' },
    { key: 'settings', name: 'Nastavení' },
    { key: 'realizace', name: 'Realizace' }
];

const RolePermissions = () => {
    const { toast } = useToast();
    const [roles, setRoles] = useState([]);
    const [permissions, setPermissions] = useState([]);
    const [selectedRole, setSelectedRole] = useState(null);

    // FIX: Removed 'selectedRole' dependency to prevent cyclical updates
    const fetchRolesAndPermissions = useCallback(async () => {
        const { data: rolesData, error: rolesError } = await supabase.from('user_roles').select('*');
        if (rolesError) {
            toast({ title: 'Chyba při načítání rolí', variant: 'destructive' });
        } else {
            setRoles(rolesData);
        }

        const { data: permissionsData, error: permissionsError } = await supabase.from('role_permissions').select('*');
        if (permissionsError) {
            toast({ title: 'Chyba při načítání oprávnění', variant: 'destructive' });
        } else {
            setPermissions(permissionsData);
        }
    }, [toast]);

    useEffect(() => {
        fetchRolesAndPermissions();
    }, [fetchRolesAndPermissions]);

    // FIX: Separate effect to handle default selection once roles are loaded
    useEffect(() => {
        if (!selectedRole && roles.length > 0) {
            setSelectedRole(roles[0]);
        }
    }, [roles, selectedRole]);

    const handlePermissionChange = (roleName, module, permissionType, value) => {
        const existingPermissionIndex = permissions.findIndex(p => p.role === roleName && p.module === module);
        
        let newPermissions = [...permissions];

        if (existingPermissionIndex !== -1) {
            newPermissions[existingPermissionIndex] = { ...newPermissions[existingPermissionIndex], [permissionType]: value };
        } else {
            const newPerm = { 
                id: crypto.randomUUID(),
                role: roleName, 
                module, 
                can_read: false, 
                can_edit: false, 
                can_admin: false,
                [permissionType]: value 
            };
            newPermissions.push(newPerm);
        }
        
        setPermissions(newPermissions);
    };

    const handleSaveChanges = async () => {
        if (!selectedRole) return;

        const upsertData = permissions
            .filter(p => p.role === selectedRole.role_name);

        const { error } = await supabase.from('role_permissions').upsert(upsertData, { onConflict: 'role,module', ignoreDuplicates: false });

        if (error) {
            toast({ title: 'Chyba při ukládání oprávnění', description: error.message, variant: 'destructive' });
        } else {
            toast({ title: '✅ Oprávnění uložena!' });
            fetchRolesAndPermissions();
        }
    };

    return (
        <div className="space-y-8">
            <PageHeader
                icon={UserCog}
                title="Role a oprávnění"
                description="Správa uživatelských rolí a jejich přístupu k modulům"
            />
            <motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                className="hidden"
            >
                <div>
                    <h1 className="text-3xl sm:text-4xl font-bold gradient-text mb-2 flex items-center gap-3">
                        <UserCog className="w-8 h-8" />
                        Role a oprávnění
                    </h1>
                    <p className="text-muted-foreground">Správa uživatelských rolí a jejich přístupu k modulům</p>
                </div>
            </motion.div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className="md:col-span-1 glass-effect rounded-xl p-6">
                    <h2 className="text-xl font-bold mb-4">Uživatelské role</h2>
                    <div className="space-y-2">
                        {roles.map(role => (
                            <div key={role.id} onClick={() => setSelectedRole(role)} className={`p-3 rounded-lg cursor-pointer transition-colors flex justify-between items-center ${selectedRole?.id === role.id ? 'bg-purple-100' : 'hover:bg-slate-100'}`}>
                                <span className="font-semibold capitalize">{role.role_name}</span>
                            </div>
                        ))}
                    </div>
                </motion.div>

                <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="md:col-span-2 glass-effect rounded-xl p-6">
                    {selectedRole ? (
                        <div>
                            <div className="flex justify-between items-center mb-4">
                                <h2 className="text-xl font-bold">Oprávnění pro roli: <span className="text-purple-600 capitalize">{selectedRole.role_name}</span></h2>
                                {selectedRole.role_name !== 'admin' && <Button onClick={handleSaveChanges}><Save className="w-4 h-4 mr-2" /> Uložit změny</Button>}
                            </div>
                            
                            {selectedRole.role_name === 'admin' ? (
                                <div className="text-center p-8 bg-blue-50 rounded-lg">
                                    <Shield className="w-12 h-12 text-blue-500 mx-auto mb-3"/>
                                    <p className="font-semibold">Role administrátora má vždy plný přístup.</p>
                                    <p className="text-sm text-muted-foreground">Oprávnění nelze měnit.</p>
                                </div>
                            ) : (
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Modul</TableHead>
                                            <TableHead className="text-center">Čtení</TableHead>
                                            <TableHead className="text-center">Editace</TableHead>
                                            <TableHead className="text-center">Administrace</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {modules.map(module => {
                                            const p = permissions.find(perm => perm.role === selectedRole.role_name && perm.module === module.key) || {};
                                            return (
                                                <TableRow key={module.key}>
                                                    <TableCell className="font-semibold capitalize">{module.name}</TableCell>
                                                    <TableCell className="text-center"><Checkbox checked={!!p.can_read} onCheckedChange={(c) => handlePermissionChange(selectedRole.role_name, module.key, 'can_read', c)} /></TableCell>
                                                    <TableCell className="text-center"><Checkbox checked={!!p.can_edit} onCheckedChange={(c) => handlePermissionChange(selectedRole.role_name, module.key, 'can_edit', c)} /></TableCell>
                                                    <TableCell className="text-center"><Checkbox checked={!!p.can_admin} onCheckedChange={(c) => handlePermissionChange(selectedRole.role_name, module.key, 'can_admin', c)} /></TableCell>
                                                </TableRow>
                                            )
                                        })}
                                    </TableBody>
                                </Table>
                            )}
                        </div>
                    ) : (
                        <div className="text-center p-8">
                            <Shield className="w-12 h-12 text-muted-foreground mx-auto mb-3"/>
                            <p className="text-muted-foreground">Vyberte roli pro zobrazení a úpravu oprávnění.</p>
                        </div>
                    )}
                </motion.div>
            </div>
        </div>
    );
};

export default RolePermissions;
