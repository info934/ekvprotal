import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Users, Plus, Edit2, Trash2, LayoutGrid, Rows, AlertTriangle, CheckCircle, Search, Filter, MoreHorizontal, Eye, Clock, Shield, Mail, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import MemberDialog from '@/components/MemberDialog';
import { supabase } from '@/lib/customSupabaseClient';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { differenceInDays, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import PageHeader from '@/components/ui/page-header';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';


const getCertificationStatus = (certifications) => {
    if (!certifications || certifications.length === 0) {
        return { icon: null, color: '', tooltip: 'Žádné certifikace' };
    }
    let soonToExpire = false;
    let expired = false;

    for (const cert of certifications) {
        if (cert.expiry_date) {
            const daysUntilExpiry = differenceInDays(parseISO(cert.expiry_date), new Date());
            if (daysUntilExpiry < 0) {
                expired = true;
                break;
            }
            if (daysUntilExpiry <= 30) {
                soonToExpire = true;
            }
        }
    }
    if (expired) {
        return { icon: AlertTriangle, color: 'text-red-500', tooltip: 'Některé certifikace jsou expirované' };
    }
    if (soonToExpire) {
        return { icon: AlertTriangle, color: 'text-yellow-500', tooltip: 'Některé certifikace brzy expirují' };
    }
    return { icon: CheckCircle, color: 'text-green-500', tooltip: 'Všechny certifikace jsou platné' };
};


const Members = () => {
    const { toast } = useToast();
    const navigate = useNavigate();
    const { hasPermission, memberId, isSuperUser, isAdmin } = useAuth();
    const [members, setMembers] = useState([]);
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [editingMember, setEditingMember] = useState(null);
    const [rewards, setRewards] = useState({});
    const [payouts, setPayouts] = useState({});
    const [view, setView] = useState('grid');
    const [searchTerm, setSearchTerm] = useState('');
    const [roleFilter, setRoleFilter] = useState('all');
    const [certificationFilter, setCertificationFilter] = useState('all');

    const canEdit = hasPermission('members', 'can_edit');
    const canAdmin = hasPermission('members', 'can_admin');
    const canViewFinance = isAdmin;

    const fetchMembersAndRewards = useCallback(async () => {
        const memberSelect = 'id, name, email, phone, role_id, auth_user_id, attendance_enabled, user_role, internal_note, languages, company, job_title, department, bio, avatar_url, language, notification_preferences, member_roles(name), member_certifications(expiry_date)';
        let membersQuery = supabase
            .from('members')
            .select(memberSelect)
            .order('name');

        const { data: membersData, error: membersError } = await membersQuery;

        if (membersError) {
            toast({ title: "Chyba při načítání zaměstnanců", variant: "destructive" });
            return;
        }
        let visibleMembers = membersData || [];
        if (isAdmin) {
            const { data: compensationRows, error: compensationError } = await supabase.rpc('list_member_compensations_admin');
            if (compensationError) {
                toast({ title: 'Chyba při načítání sazeb', description: compensationError.message, variant: 'destructive' });
                return;
            }
            const compensationByMember = new Map((compensationRows || []).map((row) => [String(row.member_id), row]));
            visibleMembers = visibleMembers.map((member) => ({
                ...member,
                hourly_rate: compensationByMember.get(String(member.id))?.hourly_rate || 0,
            }));
        }
        setMembers(visibleMembers);

        if (!canViewFinance) return;

        const { data: assignmentsData, error: assignmentsError } = await supabase.rpc('get_member_project_rewards', {
            p_member_id: isSuperUser ? null : memberId,
        });

        if (assignmentsError) {
            toast({ title: "Chyba při načítání odměn", variant: "destructive", description: assignmentsError.message });
            return;
        }

        const totalRewardsByMember = assignmentsData.reduce((acc, assignment) => {
            const reward = Number(assignment.total_reward || 0);

            acc[assignment.member_id] = (acc[assignment.member_id] || 0) + (reward > 0 ? reward : 0);
            return acc;
        }, {});

        setRewards(totalRewardsByMember);

        let payoutsQuery = supabase
            .from('payouts')
            .select('member_id, amount')
            .in('status', ['paid', 'approved', 'invoice_uploaded', 'pending']);

        if (!isSuperUser && memberId) {
            payoutsQuery = payoutsQuery.eq('member_id', memberId);
        }

        const { data: payoutsData, error: payoutsError } = await payoutsQuery;

        if (payoutsError) {
            toast({ title: "Chyba při načítání výplat", variant: "destructive" });
        } else {
            const totalPaidByMember = payoutsData.reduce((acc, payout) => {
                if (payout.member_id) {
                    acc[payout.member_id] = (acc[payout.member_id] || 0) + (parseFloat(payout.amount) || 0);
                }
                return acc;
            }, {});
            setPayouts(totalPaidByMember);
        }

    }, [toast, isAdmin, isSuperUser, memberId, canViewFinance]);

    useEffect(() => {
        fetchMembersAndRewards();
    }, [fetchMembersAndRewards]);

    const handleSaveMember = async (memberData) => {
        const cleanedData = {
            ...memberData,
            role_id: memberData.role_id || null,
            auth_user_id: memberData.auth_user_id || null,
            hourly_rate: memberData.hourly_rate || null
        };

        if (memberData.email) {
            const { data: user, error: userError } = await supabase.rpc('get_user_id_by_email', { p_email: memberData.email });
            if (userError) {
                toast({ title: 'Uživatel s tímto emailem neexistuje.', variant: 'destructive' });
                return;
            }
            if (user) {
                cleanedData.auth_user_id = user;
            }
        }

        if (editingMember) {
            const { error } = await supabase.from('members').update(cleanedData).eq('id', editingMember.id);
            if (error) {
                toast({ title: "Chyba při úpravě zaměstnance", variant: "destructive", description: error.message });
                return false;
            } else {
                toast({ title: "Zaměstnanec upraven" });
            }
        } else {
            const { error } = await supabase.from('members').insert([cleanedData]);
            if (error) {
                toast({ title: "Chyba při přidávání zaměstnance", variant: "destructive", description: error.message });
                return false;
            } else {
                toast({ title: "Zaměstnanec přidán" });
            }
        }
        fetchMembersAndRewards();
        setIsDialogOpen(false);
        setEditingMember(null);
    };

    const handleDeleteMember = async (id) => {
        if (!canAdmin) return;
        const { error } = await supabase.from('members').delete().eq('id', id);
        if (error) {
            toast({ title: "Chyba při mazání zaměstnance", variant: "destructive" });
        } else {
            toast({ title: "Zaměstnanec smazán" });
            fetchMembersAndRewards();
        }
    };

    const handleOpenDialog = (member = null) => {
        setEditingMember(member);
        setIsDialogOpen(true);
    };

    const filteredMembers = members.filter(member => {
        const matchesSearch = searchTerm === '' ||
            member.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (member.email && member.email.toLowerCase().includes(searchTerm.toLowerCase()));

        const memberRole = member.member_roles?.name || 'Bez pozice';
        const matchesRole = roleFilter === 'all' || memberRole === roleFilter;

        const matchesCertification = (() => {
            if (certificationFilter === 'all') return true;
            const certStatus = getCertificationStatus(member.member_certifications);
            return certificationFilter === 'valid' ? certStatus.icon === CheckCircle :
                certificationFilter === 'expired' ? certStatus.icon === AlertTriangle :
                    certificationFilter === 'none' ? !certStatus.icon : true;
        })();

        return matchesSearch && matchesRole && matchesCertification;
    });

    const totalMembers = members.length;
    const totalRewards = Object.values(rewards).reduce((sum, reward) => sum + reward, 0);
    const totalPayouts = Object.values(payouts).reduce((sum, payout) => sum + payout, 0);
    const pendingPayouts = totalRewards - totalPayouts;
    const membersWithExpiredCerts = members.filter(member => {
        const certStatus = getCertificationStatus(member.member_certifications);
        return certStatus.icon === AlertTriangle;
    }).length;
    const roleCounts = React.useMemo(() => {
        return members.reduce((acc, member) => {
            const role = member.member_roles?.name || 'Bez pozice';
            acc[role] = (acc[role] || 0) + 1;
            return acc;
        }, {});
    }, [members]);
    const uniqueRolesCount = Object.keys(roleCounts).filter((role) => role !== 'Bez pozice').length;
    const membersWithoutRole = roleCounts['Bez pozice'] || 0;

    const renderMemberFinancials = (memberId) => {
        if (!canViewFinance) return { totalReward: 0, balance: 0 };
        const totalReward = rewards[memberId] || 0;
        const totalPaid = payouts[memberId] || 0;
        const balance = totalReward - totalPaid;

        return { totalReward, balance };
    };

    const MemberCard = ({ member }) => {
        const { totalReward, balance } = renderMemberFinancials(member.id);
        const certStatus = getCertificationStatus(member.member_certifications);
        const CertIcon = certStatus.icon;

        return (
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                whileHover={{ y: -4, scale: 1.02 }}
                className="group bg-white border rounded-xl p-6 cursor-pointer hover:shadow-lg hover:border-primary/50 transition-all duration-200"
                onClick={() => navigate(`/members/${member.id}`)}
            >
                <div className="flex justify-between items-start mb-4">
                    <div className="flex-1 min-w-0">
                        <h3 className="font-bold text-lg truncate">{member.name}</h3>
                        <div className="flex items-center gap-2 mt-1">
                            <Badge variant="secondary" className="text-xs">
                                {member.member_roles?.name || 'Bez pozice'}
                            </Badge>
                            {CertIcon && (
                                <CertIcon
                                    title={certStatus.tooltip}
                                    className={cn("w-4 h-4", certStatus.color)}
                                />
                            )}
                        </div>
                    </div>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" aria-label={`Akce pro zamestnance ${member.name || 'bez jmena'}`} className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                                <MoreHorizontal className="h-4 w-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => navigate(`/members/${member.id}`)}>
                                <Eye className="h-4 w-4 mr-2" />
                                Zobrazit
                            </DropdownMenuItem>
                            {canEdit && (
                                <DropdownMenuItem onClick={() => handleOpenDialog(member)}>
                                    <Edit2 className="h-4 w-4 mr-2" />
                                    Upravit
                                </DropdownMenuItem>
                            )}
                            {canAdmin && (
                                <DropdownMenuItem
                                    onClick={() => handleDeleteMember(member.id)}
                                    className="text-red-600"
                                >
                                    <Trash2 className="h-4 w-4 mr-2" />
                                    Smazat
                                </DropdownMenuItem>
                            )}
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>

                <div className="space-y-3">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Mail className="w-3 h-3" />
                        <span className="truncate">{member.email || 'Není nastaven'}</span>
                    </div>

                    {canViewFinance && (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Clock className="w-3 h-3" />
                            <span>{member.hourly_rate ? `${Number(member.hourly_rate).toLocaleString('cs-CZ')} Kč/h` : 'Nenastavena'}</span>
                        </div>
                    )}

                    {canViewFinance && (
                        <div className="pt-3 border-t space-y-2">
                            <div className="flex justify-between items-center">
                                <span className="text-xs text-muted-foreground">Celková odměna:</span>
                                <span className="text-sm font-semibold">{totalReward.toLocaleString('cs-CZ')} Kč</span>
                            </div>
                            <div className="flex justify-between items-center">
                                <span className="text-xs text-muted-foreground">Zbývá k vyplacení:</span>
                                <span className={cn(
                                    "text-sm font-bold",
                                    balance > 0 ? "text-green-600" : "text-gray-500"
                                )}>
                                    {balance.toLocaleString('cs-CZ')} Kč
                                </span>
                            </div>
                        </div>
                    )}
                </div>
            </motion.div>
        );
    };

    return (
        <div className="app-page">
            <div className="space-y-6">
                <PageHeader
                    icon={Users}
                    title="Zaměstnanci"
                    description="Lidé, jejich práce, finance, vybavení a dokumenty. Každý zaměstnanec má jednu společnou kartu."
                    actions={
                        <>
                            {memberId && <Button variant="outline" onClick={() => navigate(`/members/${memberId}`)}>Moje karta</Button>}
                            {isAdmin && (
                                <Button variant="outline" onClick={() => navigate('/members?view=requests')}>
                                    <Clock className="w-4 h-4 mr-2" />
                                    Zaměstnanecké žádosti
                                </Button>
                            )}
                            {canEdit && isSuperUser && (
                                <Button onClick={() => handleOpenDialog()} className="w-full md:w-auto">
                                    <Plus className="w-4 h-4 mr-2" />
                                    Nový zaměstnanec
                                </Button>
                            )}
                            <Button variant="outline" size="sm" onClick={fetchMembersAndRewards} className="bg-white/80 hidden md:inline-flex">
                                <RefreshCw className="w-4 h-4 mr-2" />
                                Aktualizovat
                            </Button>
                        </>
                    }
                />
                {/* Stats Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <Card>
                        <CardContent className="p-4">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-blue-100 rounded-lg">
                                    <Users className="h-5 w-5 text-blue-600" />
                                </div>
                                <div>
                                    <p className="text-sm text-muted-foreground">Celkem zaměstnanců</p>
                                    <p className="text-2xl font-bold">{totalMembers}</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardContent className="p-4">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-green-100 rounded-lg">
                                    <Shield className="h-5 w-5 text-green-600" />
                                </div>
                                <div>
                                    <p className="text-sm text-muted-foreground">Pozice / kategorie</p>
                                    <p className="text-2xl font-bold">{uniqueRolesCount}</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardContent className="p-4">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-orange-100 rounded-lg">
                                    <Clock className="h-5 w-5 text-orange-600" />
                                </div>
                                <div>
                                    <p className="text-sm text-muted-foreground">K vyplacení</p>
                                    <p className={cn("text-2xl font-bold", canViewFinance && "text-orange-600")}>{canViewFinance ? pendingPayouts.toLocaleString('cs-CZ') + ' Kč' : 'N/A'}</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardContent className="p-4">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-red-100 rounded-lg">
                                    <AlertTriangle className="h-5 w-5 text-red-600" />
                                </div>
                                <div>
                                    <p className="text-sm text-muted-foreground">Expirované certifikace</p>
                                    <p className="text-2xl font-bold text-red-600">{membersWithExpiredCerts}</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {isSuperUser && (
                    <Card className="overflow-hidden">
                        <CardHeader className="border-b bg-slate-50/70 pb-4">
                            <CardTitle className="text-base">Pozice a kategorie zaměstnanců</CardTitle>
                        </CardHeader>
                        <CardContent className="p-4">
                            <div className="flex flex-wrap gap-2">
                                <Button
                                    variant={roleFilter === 'all' ? 'default' : 'outline'}
                                    size="sm"
                                    onClick={() => setRoleFilter('all')}
                                >
                                    Všechny pozice
                                    <Badge variant="secondary" className="ml-2">{totalMembers}</Badge>
                                </Button>
                                {Object.entries(roleCounts)
                                    .filter(([role]) => role !== 'Bez pozice')
                                    .sort(([a], [b]) => a.localeCompare(b, 'cs-CZ'))
                                    .map(([role, count]) => (
                                        <Button
                                            key={role}
                                            variant={roleFilter === role ? 'default' : 'outline'}
                                            size="sm"
                                            onClick={() => setRoleFilter(roleFilter === role ? 'all' : role)}
                                        >
                                            {role}
                                            <Badge variant="secondary" className="ml-2">{count}</Badge>
                                        </Button>
                                    ))}
                                {membersWithoutRole > 0 && (
                                    <Button
                                        variant={roleFilter === 'Bez pozice' ? 'default' : 'outline'}
                                        size="sm"
                                        onClick={() => setRoleFilter(roleFilter === 'Bez pozice' ? 'all' : 'Bez pozice')}
                                    >
                                        Bez pozice
                                        <Badge variant="secondary" className="ml-2">{membersWithoutRole}</Badge>
                                    </Button>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                )}

                {/* Filters and Search - pouze pro super uživatele */}
                {isSuperUser && (
                    <Card>
                        <CardContent className="p-6">
                            <div className="flex flex-col lg:flex-row gap-4 items-start lg:items-center justify-between">
                                <div className="relative flex-1 w-full max-w-md">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                    <Input
                                        placeholder="Hledat zaměstnance..."
                                        className="pl-10"
                                        value={searchTerm}
                                        onChange={(e) => setSearchTerm(e.target.value)}
                                    />
                                </div>

                                <div className="flex flex-wrap gap-2 items-center">
                                    <div className="flex items-center gap-2">
                                        <Filter className="h-4 w-4 text-muted-foreground" />
                                        <Select value={roleFilter} onValueChange={setRoleFilter}>
                                            <SelectTrigger className="w-[160px]">
                                                <SelectValue placeholder="Všechny pozice" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="all">Všechny pozice</SelectItem>
                                                {Array.from(new Set(members.map(m => m.member_roles?.name).filter(Boolean))).map(role => (
                                                    <SelectItem key={role} value={role}>{role}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>

                                        <Select value={certificationFilter} onValueChange={setCertificationFilter}>
                                            <SelectTrigger className="w-[180px]">
                                                <SelectValue placeholder="Všechny certifikace" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="all">Všechny certifikace</SelectItem>
                                                <SelectItem value="valid">Platné</SelectItem>
                                                <SelectItem value="expired">Expirované</SelectItem>
                                                <SelectItem value="none">Bez certifikací</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>

                                    <div className="flex gap-2">
                                        <Button
                                            variant={view === 'grid' ? 'default' : 'outline'}
                                            size="sm"
                                            onClick={() => setView('grid')}
                                        >
                                            <LayoutGrid className="w-4 h-4 mr-2" />
                                            Karty
                                        </Button>
                                        <Button
                                            variant={view === 'table' ? 'default' : 'outline'}
                                            size="sm"
                                            onClick={() => setView('table')}
                                        >
                                            <Rows className="w-4 h-4 mr-2" />
                                            Tabulka
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                )}

                {/* Content */}
                {filteredMembers.length > 0 ? (
                    view === 'grid' ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            <AnimatePresence>
                                {filteredMembers.map(member => (
                                    <MemberCard key={member.id} member={member} />
                                ))}
                            </AnimatePresence>
                        </div>
                    ) : (
                        <Card className="overflow-hidden">
                            <CardContent className="p-0">
                                <div className="overflow-x-auto">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead className="w-[250px]">Jméno</TableHead>
                                                <TableHead>Pozice / kategorie</TableHead>
                                                <TableHead>Certifikace</TableHead>
                                                {canViewFinance && <TableHead>Hodinová sazba</TableHead>}
                                                {canViewFinance && <TableHead>Celková odměna</TableHead>}
                                                {canViewFinance && <TableHead>Zbývá k vyplacení</TableHead>}
                                                <TableHead className="w-[50px]"></TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {filteredMembers.map(member => {
                                                const { totalReward, balance } = renderMemberFinancials(member.id);
                                                const certStatus = getCertificationStatus(member.member_certifications);
                                                const CertIcon = certStatus.icon;

                                                return (
                                                    <TableRow
                                                        key={member.id}
                                                        className="cursor-pointer hover:bg-muted/50 transition-colors group"
                                                        onClick={(e) => { e.stopPropagation(); navigate(`/members/${member.id}`);}}
                                                    >
                                                        <TableCell>
                                                            <div className="font-medium">{member.name}</div>
                                                            <div className="text-xs text-muted-foreground truncate">{member.email}</div>
                                                        </TableCell>
                                                        <TableCell>
                                                            <Badge variant="secondary" className="text-xs">
                                                                {member.member_roles?.name || 'Bez pozice'}
                                                            </Badge>
                                                        </TableCell>
                                                        <TableCell>
                                                            {CertIcon && (
                                                                <CertIcon
                                                                    title={certStatus.tooltip}
                                                                    className={cn("w-5 h-5", certStatus.color)}
                                                                />
                                                            )}
                                                        </TableCell>
                                                        {canViewFinance && (
                                                            <TableCell className="font-semibold">
                                                                {member.hourly_rate ? `${Number(member.hourly_rate).toLocaleString('cs-CZ')} Kč` : 'Nenastavena'}
                                                            </TableCell>
                                                        )}
                                                        {canViewFinance && <TableCell>{totalReward.toLocaleString('cs-CZ')} Kč</TableCell>}
                                                        {canViewFinance && <TableCell className={cn(
                                                            "font-semibold",
                                                            balance > 0 ? "text-green-600" : "text-gray-500"
                                                        )}>
                                                            {balance.toLocaleString('cs-CZ')} Kč
                                                        </TableCell>}
                                                        <TableCell onClick={(e) => e.stopPropagation()}>
                                                            <DropdownMenu>
                                                                <DropdownMenuTrigger asChild>
                                                                    <Button variant="ghost" size="sm" aria-label={`Akce pro zamestnance ${member.name || 'bez jmena'}`} className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                                                        <MoreHorizontal className="h-4 w-4" />
                                                                    </Button>
                                                                </DropdownMenuTrigger>
                                                                <DropdownMenuContent align="end">
                                                                    <DropdownMenuItem onClick={(e) => { e.stopPropagation(); navigate(`/members/${member.id}`); }}>
                                                                        <Eye className="h-4 w-4 mr-2" />
                                                                        Zobrazit
                                                                    </DropdownMenuItem>
                                                                    {canEdit && (
                                                                        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleOpenDialog(member); }}>
                                                                            <Edit2 className="h-4 w-4 mr-2" />
                                                                            Upravit
                                                                        </DropdownMenuItem>
                                                                    )}
                                                                    {canAdmin && (
                                                                        <DropdownMenuItem
                                                                            onClick={(e) => { e.stopPropagation(); handleDeleteMember(member.id); }}
                                                                            className="text-red-600"
                                                                        >
                                                                            <Trash2 className="h-4 w-4 mr-2" />
                                                                            Smazat
                                                                        </DropdownMenuItem>
                                                                    )}
                                                                </DropdownMenuContent>
                                                            </DropdownMenu>
                                                        </TableCell>
                                                    </TableRow>
                                                );
                                            })}
                                        </TableBody>
                                    </Table>
                                </div>
                            </CardContent>
                        </Card>
                    )
                ) : (
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="text-center py-12"
                    >
                        <Card className="max-w-md mx-auto">
                            <CardContent className="p-8">
                                <Users className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                                <h3 className="text-lg font-semibold mb-2">Žádní zaměstnanci nenalezeni</h3>
                                <p className="text-muted-foreground mb-4">
                                    Zkuste změnit filtry nebo vytvořte nového zaměstnance.
                                </p>
                                {canEdit && (
                                    <Button onClick={() => handleOpenDialog()}>
                                        <Plus className="w-4 h-4 mr-2" />
                                        Vytvořit zaměstnance
                                    </Button>
                                )}
                            </CardContent>
                        </Card>
                    </motion.div>
                )}

                <MemberDialog
                    isOpen={isDialogOpen}
                    onClose={() => { setIsDialogOpen(false); setEditingMember(null); }}
                    onSave={handleSaveMember}
                    member={editingMember}
                />
            </div>
        </div>
    );
};

export default Members;
