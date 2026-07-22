import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Ban,
  Briefcase,
  CheckCircle2,
  Clock,
  Eye,
  KeyRound,
  Mail,
  MoreHorizontal,
  RefreshCw,
  Search,
  Shield,
  Trash2,
  UserCheck,
  UserCog,
  UserPlus,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { Dialog } from '@/components/ui/dialog';
import { FormDialogBody, FormDialogContent, FormDialogFooter, FormDialogHeader } from '@/components/ui/form-dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supabase } from '@/lib/customSupabaseClient';
import { invokeWithTimeout } from '@/lib/requestControl';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import PageHeader from '@/components/ui/page-header';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

const STATUS_LABELS = {
  active: 'Aktivní',
  invited: 'Pozván',
  disabled: 'Deaktivovaný',
};

const STATUS_VARIANTS = {
  active: 'success',
  invited: 'warning',
  disabled: 'destructive',
};

const formatDateTime = (value) => {
  if (!value) return '-';
  return new Intl.DateTimeFormat('cs-CZ', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
};

const roleLabel = (role) => {
  if (!role) return 'Bez role';
  return String(role).replaceAll('_', ' ').replace(/^./, (char) => char.toUpperCase());
};

const getDisplayName = (user) => user?.user_metadata?.full_name || user?.member_name || user?.email || 'Bez jména';

const UserManagement = () => {
  const { toast } = useToast();
  const { user: currentUser, isAdmin } = useAuth();
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [availableMembers, setAvailableMembers] = useState([]);
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [confirmAction, setConfirmAction] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [loading, setLoading] = useState(false);

  const invokeFunction = useCallback(async (payload) => invokeWithTimeout(supabase, 'manage-users', { body: payload }), []);

  const fetchMembers = useCallback(async () => {
    const { data, error } = await supabase
      .from('members')
      .select('id, name, email, auth_user_id, user_role')
      .is('auth_user_id', null)
      .order('name', { ascending: true });

    if (!error) setAvailableMembers(data || []);
  }, []);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    const { data, error } = await invokeFunction({ action: 'list_users' });
    setLoading(false);

    if (error || data?.error) {
      toast({ title: 'Uživatele se nepodařilo načíst', description: data?.error || error?.message, variant: 'destructive' });
      return;
    }

    setUsers(data?.users || []);
    setRoles(data?.roles || []);
  }, [invokeFunction, toast]);

  useEffect(() => {
    fetchUsers();
    fetchMembers();
  }, [fetchUsers, fetchMembers]);

  const runUserAction = async (action, payload, successTitle) => {
    const { data, error } = await invokeFunction({ action, payload });
    if (error || data?.error) {
      toast({ title: 'Akce se nepodařila', description: data?.error || error?.message || 'Neznámá chyba', variant: 'destructive' });
      return false;
    }
    toast({ title: successTitle });
    await fetchUsers();
    await fetchMembers();
    return true;
  };

  const handleRoleChange = async (user, newRole) => {
    if (!newRole || newRole === user.role) return;
    await runUserAction('update_user_role', { userId: user.id, role: newRole }, 'Role uživatele byla změněna.');
  };

  const filteredUsers = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return (users || []).filter((user) => {
      const name = getDisplayName(user).toLowerCase();
      const email = (user.email || '').toLowerCase();
      const matchesSearch = !query || name.includes(query) || email.includes(query);
      const matchesRole = roleFilter === 'all' || (roleFilter === 'none' ? !user.role : user.role === roleFilter);
      const matchesStatus =
        statusFilter === 'all' ||
        user.account_status === statusFilter ||
        (statusFilter === 'without_employee' && !user.is_member) ||
        (statusFilter === 'without_role' && !user.role) ||
        (statusFilter === 'admin' && user.role === 'admin');
      return matchesSearch && matchesRole && matchesStatus;
    });
  }, [users, searchTerm, roleFilter, statusFilter]);

  const summary = useMemo(() => {
    const list = users || [];
    return {
      all: list.length,
      active: list.filter((u) => u.account_status === 'active').length,
      invited: list.filter((u) => u.account_status === 'invited').length,
      disabled: list.filter((u) => u.account_status === 'disabled').length,
      without_role: list.filter((u) => !u.role).length,
      without_employee: list.filter((u) => !u.is_member).length,
      admin: list.filter((u) => u.role === 'admin').length,
    };
  }, [users]);

  const summaryCards = [
    { filter: 'all', label: 'Celkem', value: summary.all, icon: Users, tone: 'bg-blue-50 text-blue-700' },
    { filter: 'active', label: 'Aktivní', value: summary.active, icon: CheckCircle2, tone: 'bg-emerald-50 text-emerald-700' },
    { filter: 'invited', label: 'Pozvaní', value: summary.invited, icon: Mail, tone: 'bg-amber-50 text-amber-700' },
    { filter: 'disabled', label: 'Deaktivovaní', value: summary.disabled, icon: Ban, tone: 'bg-rose-50 text-rose-700' },
    { filter: 'without_role', label: 'Bez role', value: summary.without_role, icon: Shield, tone: 'bg-slate-100 text-slate-700' },
    { filter: 'without_employee', label: 'Bez zaměstnance', value: summary.without_employee, icon: Briefcase, tone: 'bg-violet-50 text-violet-700' },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        icon={UserCog}
        title="Správa uživatelů"
        description="Účty vznikají pozvánkou administrátora. Hesla se nastavují pouze bezpečným e-mailovým odkazem."
        actions={
          <>
            <Button variant="outline" onClick={fetchUsers} disabled={loading} className="w-full sm:w-auto">
              <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} /> Obnovit
            </Button>
            <Button onClick={() => setIsInviteOpen(true)} disabled={!isAdmin} className="w-full sm:w-auto">
              <UserPlus className="mr-2 h-4 w-4" /> Pozvat uživatele
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {summaryCards.map((card) => {
          const Icon = card.icon;
          const active = statusFilter === card.filter || (card.filter === 'all' && statusFilter === 'all');
          return (
            <button
              key={card.filter}
              type="button"
              onClick={() => setStatusFilter(card.filter === 'all' ? 'all' : statusFilter === card.filter ? 'all' : card.filter)}
              className={cn('app-surface p-4 text-left transition hover:border-blue-200 hover:shadow-sm', active && 'border-blue-300 bg-blue-50/30 ring-1 ring-blue-100')}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{card.label}</p>
                  <p className="mt-1 text-2xl font-semibold text-slate-950">{card.value}</p>
                </div>
                <div className={cn('grid h-10 w-10 place-items-center rounded-xl', card.tone)}>
                  <Icon className="h-5 w-5" />
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="app-surface overflow-hidden">
        <div className="border-b bg-slate-50/70 p-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Uživatelé portálu</h2>
              <p className="text-sm text-slate-500">Zobrazeno {filteredUsers.length} z {users.length} účtů.</p>
            </div>
            <div className="flex flex-col gap-2 lg:flex-row">
              <div className="relative w-full lg:w-80">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <Input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Hledat jméno nebo e-mail..." className="pl-9" />
              </div>
              <Select value={roleFilter} onValueChange={setRoleFilter}>
                <SelectTrigger className="w-full lg:w-56"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Všechny role</SelectItem>
                  {roles.map((role) => <SelectItem key={role} value={role}>{roleLabel(role)}</SelectItem>)}
                  <SelectItem value="none">Bez role</SelectItem>
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full lg:w-56"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Všechny stavy</SelectItem>
                  <SelectItem value="active">Aktivní</SelectItem>
                  <SelectItem value="invited">Pozvaní</SelectItem>
                  <SelectItem value="disabled">Deaktivovaní</SelectItem>
                  <SelectItem value="without_role">Bez role</SelectItem>
                  <SelectItem value="without_employee">Bez zaměstnance</SelectItem>
                  <SelectItem value="admin">Administrátoři</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Uživatel</TableHead>
              <TableHead>Stav účtu</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Zaměstnanec</TableHead>
              <TableHead>Poslední přihlášení</TableHead>
              <TableHead className="text-right">Akce</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredUsers.map((user) => {
              const isCurrentUser = user.id === currentUser?.id;
              const isDisabled = user.account_status === 'disabled';
              return (
                <TableRow key={user.id}>
                  <TableCell className="min-w-[280px]">
                    <div className="flex items-center gap-3">
                      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-blue-50 text-sm font-semibold text-blue-700">
                        {getDisplayName(user).slice(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="truncate font-semibold text-slate-950">{getDisplayName(user)}</p>
                          {isCurrentUser && <Badge variant="outline">Vy</Badge>}
                        </div>
                        <p className="truncate text-xs text-slate-500">{user.email}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANTS[user.account_status] || 'secondary'}>{STATUS_LABELS[user.account_status] || user.account_status || 'Neznámý'}</Badge>
                    {user.account_status_reason && <p className="mt-1 max-w-[220px] truncate text-xs text-slate-500">{user.account_status_reason}</p>}
                  </TableCell>
                  <TableCell>
                    <Select value={user.role || ''} onValueChange={(value) => handleRoleChange(user, value)} disabled={!isAdmin || isCurrentUser || !user.is_member || isDisabled}>
                      <SelectTrigger className="h-9 w-44"><SelectValue placeholder="Bez role" /></SelectTrigger>
                      <SelectContent>
                        {roles.map((role) => <SelectItem key={role} value={role}>{roleLabel(role)}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    {user.is_member ? (
                      <Badge variant="success"><Briefcase className="h-3 w-3" /> {user.member_name || 'Propojeno'}</Badge>
                    ) : (
                      <Badge variant="warning">Bez zaměstnance</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2 text-sm text-slate-600">
                      <Clock className="h-4 w-4 text-slate-400" />
                      {formatDateTime(user.last_sign_in_at)}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="icon" className="h-9 w-9" disabled={!isAdmin}>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-64">
                        <DropdownMenuLabel>{user.email}</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => setSelectedUser(user)}><Eye className="mr-2 h-4 w-4" /> Detail účtu</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => runUserAction('reset_password', { userId: user.id, email: user.email }, 'Reset hesla byl odeslán.') }><KeyRound className="mr-2 h-4 w-4" /> Poslat reset hesla</DropdownMenuItem>
                        {user.account_status === 'invited' && (
                          <DropdownMenuItem onClick={() => runUserAction('resend_invite', { userId: user.id, email: user.email }, 'Pozvánka byla znovu odeslána.') }><Mail className="mr-2 h-4 w-4" /> Znovu poslat pozvánku</DropdownMenuItem>
                        )}
                        {!user.is_member && (
                          <DropdownMenuItem onClick={() => runUserAction('create_member_from_user', { userId: user.id, email: user.email, full_name: getDisplayName(user), role: user.role || 'user' }, 'Uživatel byl propojen se zaměstnancem.') }><Briefcase className="mr-2 h-4 w-4" /> Propojit se zaměstnancem</DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        {isDisabled ? (
                          <DropdownMenuItem onClick={() => runUserAction('reactivate_user', { userId: user.id, email: user.email }, 'Účet byl znovu aktivován.') }><UserCheck className="mr-2 h-4 w-4" /> Aktivovat účet</DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem disabled={isCurrentUser} onClick={() => setConfirmAction({ type: 'deactivate', user })}><Ban className="mr-2 h-4 w-4" /> Deaktivovat účet</DropdownMenuItem>
                        )}
                        <DropdownMenuItem disabled={isCurrentUser} className="text-rose-700 focus:text-rose-700" onClick={() => setConfirmAction({ type: 'delete', user })}><Trash2 className="mr-2 h-4 w-4" /> Smazat účet</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              );
            })}
            {filteredUsers.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-12 text-center text-slate-500">Žádní uživatelé neodpovídají filtrům.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </motion.section>

      <InviteUserDialog
        open={isInviteOpen}
        onOpenChange={setIsInviteOpen}
        roles={roles}
        members={availableMembers}
        onSubmit={async (values) => {
          const ok = await runUserAction('invite_user', values, 'Pozvánka byla odeslána.');
          if (ok) setIsInviteOpen(false);
        }}
      />

      <UserDetailDialog user={selectedUser} open={!!selectedUser} onOpenChange={(open) => !open && setSelectedUser(null)} />

      <ConfirmUserActionDialog
        action={confirmAction}
        onOpenChange={(open) => !open && setConfirmAction(null)}
        onConfirm={async (reason) => {
          if (!confirmAction) return;
          const { type, user } = confirmAction;
          const ok = type === 'delete'
            ? await runUserAction('delete_user_nopass', { userId: user.id, email: user.email }, 'Účet byl smazán.')
            : await runUserAction('deactivate_user', { userId: user.id, email: user.email, reason }, 'Účet byl deaktivován.');
          if (ok) setConfirmAction(null);
        }}
      />
    </div>
  );
};

const InviteUserDialog = ({ open, onOpenChange, roles, members, onSubmit }) => {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('user');
  const [memberId, setMemberId] = useState('none');
  const [submitting, setSubmitting] = useState(false);

  const selectedMember = members.find((member) => member.id === memberId);

  useEffect(() => {
    if (selectedMember) {
      setFullName(selectedMember.name || '');
      setEmail(selectedMember.email || '');
      setRole(selectedMember.user_role || role || 'user');
    }
  }, [selectedMember]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    await onSubmit({ full_name: fullName, email, role, member_id: memberId === 'none' ? null : memberId });
    setSubmitting(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <FormDialogContent size="lg">
        <FormDialogHeader icon={UserPlus} title="Pozvat uživatele" description="Uživatel dostane e-mail s bezpečným odkazem pro nastavení hesla. Heslo administrátor nikdy nenastavuje ručně." />
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <FormDialogBody className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2 md:col-span-2">
              <Label>Propojit s existujícím zaměstnancem</Label>
              <Select value={memberId} onValueChange={setMemberId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nevybráno, vytvořit nový profil</SelectItem>
                  {members.map((member) => <SelectItem key={member.id} value={member.id}>{member.name} · {member.email || 'bez e-mailu'}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-name">Jméno</Label>
              <Input id="invite-name" value={fullName} onChange={(event) => setFullName(event.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-email">E-mail</Label>
              <Input id="invite-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Role</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {roles.map((item) => <SelectItem key={item} value={item}>{roleLabel(item)}</SelectItem>)}
                  {roles.length === 0 && <SelectItem value="user">User</SelectItem>}
                </SelectContent>
              </Select>
            </div>
          </FormDialogBody>
          <FormDialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Zrušit</Button>
            <Button type="submit" disabled={submitting}>{submitting ? 'Odesílám...' : 'Odeslat pozvánku'}</Button>
          </FormDialogFooter>
        </form>
      </FormDialogContent>
    </Dialog>
  );
};

const UserDetailDialog = ({ user, open, onOpenChange }) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <FormDialogContent size="lg">
      <FormDialogHeader icon={UserCog} title="Detail uživatele" description="Přehled účtu, role, propojení na zaměstnance a stav přístupu." />
      {user && (
        <FormDialogBody className="grid gap-4 md:grid-cols-2">
          <InfoBox label="Jméno" value={getDisplayName(user)} />
          <InfoBox label="E-mail" value={user.email} />
          <InfoBox label="Stav" value={STATUS_LABELS[user.account_status] || user.account_status} />
          <InfoBox label="Role" value={roleLabel(user.role)} />
          <InfoBox label="Zaměstnanec" value={user.is_member ? user.member_name || 'Propojeno' : 'Bez zaměstnance'} />
          <InfoBox label="Poslední přihlášení" value={formatDateTime(user.last_sign_in_at)} />
          <InfoBox label="Potvrzení e-mailu" value={formatDateTime(user.email_confirmed_at)} />
          <InfoBox label="Vytvořeno" value={formatDateTime(user.created_at)} />
        </FormDialogBody>
      )}
      <FormDialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>Zavřít</Button>
      </FormDialogFooter>
    </FormDialogContent>
  </Dialog>
);

const InfoBox = ({ label, value }) => (
  <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
    <div className="mt-1 break-words text-sm font-medium text-slate-950">{value || '-'}</div>
  </div>
);

const ConfirmUserActionDialog = ({ action, onOpenChange, onConfirm }) => {
  const [reason, setReason] = useState('');
  const user = action?.user;
  const isDelete = action?.type === 'delete';

  useEffect(() => {
    if (!action) setReason('');
  }, [action]);

  return (
    <AlertDialog open={!!action} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{isDelete ? 'Smazat účet?' : 'Deaktivovat účet?'}</AlertDialogTitle>
          <AlertDialogDescription>
            {isDelete
              ? `Účet ${user?.email || ''} bude trvale odstraněn ze Supabase Auth. Běžně je bezpečnější účet deaktivovat.`
              : `Účet ${user?.email || ''} se po dalším načtení relace nedostane do portálu. Akce se zapíše do auditu.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {!isDelete && (
          <div className="space-y-2">
            <Label htmlFor="deactivate-reason">Důvod deaktivace</Label>
            <Input id="deactivate-reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Např. ukončená spolupráce" />
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Zrušit</AlertDialogCancel>
          <AlertDialogAction className={isDelete ? 'bg-rose-600 hover:bg-rose-700' : ''} onClick={() => onConfirm(reason)}>
            {isDelete ? 'Ano, smazat' : 'Deaktivovat'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default UserManagement;
