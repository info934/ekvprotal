import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Shield, Save, UserCog, Eye, Pencil, Crown, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import PageHeader from '@/components/ui/page-header';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

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

const permissionLevels = [
    { key: 'can_read', label: 'Čtení', description: 'Vidí modul a záznamy', icon: Eye },
    { key: 'can_edit', label: 'Editace', description: 'Může vytvářet a upravovat', icon: Pencil },
    { key: 'can_admin', label: 'Správa', description: 'Může schvalovat a mazat', icon: Crown },
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
        const checked = Boolean(value);
        
        let newPermissions = [...permissions];
        const applyDependency = (permission) => {
            const next = { ...permission, [permissionType]: checked };
            if (checked && permissionType === 'can_edit') next.can_read = true;
            if (checked && permissionType === 'can_admin') {
                next.can_read = true;
                next.can_edit = true;
            }
            if (!checked && permissionType === 'can_read') {
                next.can_edit = false;
                next.can_admin = false;
            }
            if (!checked && permissionType === 'can_edit') next.can_admin = false;
            return next;
        };

        if (existingPermissionIndex !== -1) {
            newPermissions[existingPermissionIndex] = applyDependency(newPermissions[existingPermissionIndex]);
        } else {
            const newPerm = applyDependency({ 
                id: crypto.randomUUID(),
                role: roleName, 
                module, 
                can_read: false, 
                can_edit: false, 
                can_admin: false,
            });
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
                title="Přístupové role a oprávnění"
                description="Správa přístupových rolí uživatelských účtů a jejich práv k modulům."
            />
            <motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                className="hidden"
            >
                <div>
                    <h1 className="text-3xl sm:text-4xl font-bold gradient-text mb-2 flex items-center gap-3">
                        <UserCog className="w-8 h-8" />
                        Přístupové role a oprávnění
                    </h1>
                    <p className="text-muted-foreground">Správa uživatelských rolí a jejich přístupu k modulům</p>
                </div>
            </motion.div>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-[280px_minmax(0,1fr)]">
                <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className="app-surface p-4">
                    <div className="mb-4">
                        <h2 className="text-lg font-semibold">Přístupové role</h2>
                        <p className="text-sm text-muted-foreground">Vyberte roli účtu a nastavte její přístup.</p>
                    </div>
                    <div className="space-y-2">
                        {roles.map(role => (
                            <button
                                type="button"
                                key={role.id}
                                onClick={() => setSelectedRole(role)}
                                className={cn(
                                    'flex w-full items-center justify-between rounded-lg border px-3 py-3 text-left transition-colors',
                                    selectedRole?.id === role.id
                                        ? 'border-primary bg-primary/5 text-primary'
                                        : 'border-transparent hover:border-slate-200 hover:bg-slate-50'
                                )}
                            >
                                <span>
                                    <span className="block font-semibold capitalize">{role.role_name}</span>
                                    <span className="text-xs text-muted-foreground">
                                        {role.role_name === 'admin' ? 'Plný přístup' : 'Vlastní oprávnění'}
                                    </span>
                                </span>
                                {selectedRole?.id === role.id && <CheckCircle2 className="h-4 w-4" />}
                            </button>
                        ))}
                    </div>
                </motion.div>

                <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="app-surface min-w-0 p-4 sm:p-6">
                    {selectedRole ? (
                        <div>
                            <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                                <div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <h2 className="text-xl font-semibold">Oprávnění přístupové role</h2>
                                        <Badge variant={selectedRole.role_name === 'admin' ? 'info' : 'secondary'} className="capitalize">
                                            {selectedRole.role_name}
                                        </Badge>
                                    </div>
                                    <p className="mt-1 text-sm text-muted-foreground">
                                        Vyšší úroveň automaticky zahrnuje nižší práva: správa obsahuje editaci i čtení.
                                    </p>
                                </div>
                                {selectedRole.role_name !== 'admin' && (
                                    <Button onClick={handleSaveChanges} className="shrink-0">
                                        <Save className="w-4 h-4 mr-2" /> Uložit změny
                                    </Button>
                                )}
                            </div>
                            
                            {selectedRole.role_name === 'admin' ? (
                                <div className="rounded-lg border border-blue-100 bg-blue-50 p-8 text-center">
                                    <Shield className="w-12 h-12 text-blue-500 mx-auto mb-3"/>
                                    <p className="font-semibold">Role administrátora má vždy plný přístup.</p>
                                    <p className="text-sm text-muted-foreground">Oprávnění nelze měnit.</p>
                                </div>
                            ) : (
                                <div className="overflow-x-auto rounded-lg border">
                                    <Table>
                                        <TableHeader>
                                            <TableRow className="bg-slate-50">
                                                <TableHead className="min-w-[180px]">Modul</TableHead>
                                                {permissionLevels.map(level => (
                                                    <TableHead key={level.key} className="min-w-[150px] text-center">
                                                        <div className="flex flex-col items-center gap-1 py-1">
                                                            <div className="flex items-center gap-1.5 font-semibold text-slate-800">
                                                                <level.icon className="h-4 w-4" />
                                                                {level.label}
                                                            </div>
                                                            <span className="text-xs font-normal text-muted-foreground">{level.description}</span>
                                                        </div>
                                                    </TableHead>
                                                ))}
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {modules.map(module => {
                                                const p = permissions.find(perm => perm.role === selectedRole.role_name && perm.module === module.key) || {};
                                                return (
                                                    <TableRow key={module.key}>
                                                        <TableCell>
                                                            <div className="font-semibold">{module.name}</div>
                                                            <div className="text-xs text-muted-foreground">{module.key}</div>
                                                        </TableCell>
                                                        {permissionLevels.map(level => (
                                                            <TableCell key={level.key} className="text-center">
                                                                <Checkbox
                                                                    checked={!!p[level.key]}
                                                                    onCheckedChange={(c) => handlePermissionChange(selectedRole.role_name, module.key, level.key, c)}
                                                                    aria-label={`${level.label}: ${module.name}`}
                                                                />
                                                            </TableCell>
                                                        ))}
                                                    </TableRow>
                                                )
                                            })}
                                        </TableBody>
                                    </Table>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="p-8 text-center">
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
