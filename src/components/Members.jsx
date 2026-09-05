import { loadMemberDirectory } from '@/lib/memberDirectoryData';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Users, Plus, Edit2, Trash2, LayoutGrid, Rows, AlertTriangle, CheckCircle, Search, Filter, MoreHorizontal, Eye, Clock, Shield, Mail, RefreshCw } from 'lucide-react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import MemberDialog from '@/components/MemberDialog';
import { supabase } from '@/lib/customSupabaseClient';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { certificationState, matchesCertification, directoryFilters } from '@/lib/memberDirectory';
import { isRecordActivation } from '@/lib/listWorkspaceState';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import PageHeader from '@/components/ui/page-header';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';


const getCertificationStatus = certifications => ({
 none: {icon:null,color:'',tooltip:'Žádné certifikace'},
 expired: {icon:AlertTriangle,color:'text-red-600',tooltip:'Některé certifikace jsou expirované'},
 soon: {icon:AlertTriangle,color:'text-amber-600',tooltip:'Certifikace končí do 30 dnů'},
 valid: {icon:CheckCircle,color:'text-green-600',tooltip:'Všechny certifikace jsou platné'},
})[certificationState(certifications)];

const Members = () => {
    const { toast } = useToast();
    const navigate = useNavigate();
    const { hasPermission, memberId, isSuperUser, isAdmin } = useAuth();
    const [members, setMembers] = useState([]);
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [editingMember, setEditingMember] = useState(null);
    const [rewards, setRewards] = useState({});
    const [payouts, setPayouts] = useState({});
    const [params,setParams]=useSearchParams();
    const location=useLocation();
    const filters=directoryFilters(params);
    const view=filters.view,searchTerm=filters.q,roleFilter=filters.role,certificationFilter=filters.cert;
    const updateFilter=(key,value)=>setParams(previous=>{const next=new URLSearchParams(previous);if(!value||value==='all'||(key==='view'&&value==='grid'))next.delete(key);else next.set(key,value);return next;},{replace:true});
    const setView=value=>updateFilter('view',value);
    const setSearchTerm=value=>updateFilter('q',value);
    const setRoleFilter=value=>updateFilter('role',value);
    const setCertificationFilter=value=>updateFilter('cert',value);
    const resetFilters=()=>setParams(previous=>{const next=new URLSearchParams(previous);['q','role','cert'].forEach(key=>next.delete(key));return next;},{replace:true});
    const openMember=id=>navigate(`/members/${id}`,{state:{returnTo:location.pathname+location.search}});
    const [deleteCandidate,setDeleteCandidate]=useState(null);
    const [deleting,setDeleting]=useState(false);

    const [loading,setLoading]=useState(true);
    const [loadError,setLoadError]=useState('');
    const [financeReady,setFinanceReady]=useState(false);
    const [financeError,setFinanceError]=useState('');
    const pendingLoad=useRef(null);
    const canEdit = hasPermission('members', 'can_edit');
    const canAdmin = hasPermission('members', 'can_admin');
    const canViewFinance = isAdmin;

    const fetchMembersAndRewards = useCallback(async () => {
        pendingLoad.current?.abort();
        const controller=new AbortController();pendingLoad.current=controller;
        setLoading(true);setLoadError('');setFinanceError('');setFinanceReady(false);
        setMembers([]);setRewards({});setPayouts({});
        const timeout=setTimeout(()=>controller.abort(),20000);
        try {
            const result=await loadMemberDirectory(supabase,{isAdmin,isSuperUser,memberId,signal:controller.signal});
            if(pendingLoad.current!==controller)return;
            setMembers(result.members);setRewards(result.rewards);setPayouts(result.payouts);setFinanceReady(result.financeReady);setFinanceError(result.financeError);
        } catch(error) {
            if(pendingLoad.current===controller)setLoadError('Seznam zaměstnanců se nepodařilo načíst. Zkontrolujte připojení a zkuste to znovu.');
        } finally {clearTimeout(timeout);if(pendingLoad.current===controller)setLoading(false);}
    }, [isAdmin,isSuperUser,memberId]);
    useEffect(()=>{void fetchMembersAndRewards();return()=>{pendingLoad.current?.abort();pendingLoad.current=null;};},[fetchMembersAndRewards]);

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
        if(deleting)return;
        setDeleting(true);
        const { error } = await supabase.from('members').delete().eq('id', id);
        setDeleting(false);
        if (error) {
            toast({ title: "Chyba při mazání zaměstnance", variant: "destructive" });
        } else {
            toast({ title: "Zaměstnanec smazán" });
            setDeleteCandidate(null);
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

        const matchesCert = matchesCertification(member.member_certifications,certificationFilter);

        return matchesSearch && matchesRole && matchesCert;
    });

    const totalMembers = members.length;
    const totalRewards = Object.values(rewards).reduce((sum, reward) => sum + reward, 0);
    const totalPayouts = Object.values(payouts).reduce((sum, payout) => sum + payout, 0);
    const pendingPayouts = totalRewards - totalPayouts;
    const membersWithExpiredCerts = members.filter(member => {
        return certificationState(member.member_certifications) === 'expired';
    }).length;
    const roleCounts = React.useMemo(() => {
        return members.reduce((acc, member) => {
            const role = member.member_roles?.name || 'Bez pozice';
            acc[role] = (acc[role] || 0) + 1;
            return acc;
        }, {});
    }, [members]);
    const uniqueRolesCount = Object.keys(roleCounts).filter((role) => role !== 'Bez pozice').length;


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
                whileHover={{ y: -2 }}
                className="group bg-white border rounded-xl p-4 cursor-pointer hover:shadow-md hover:border-primary/50 transition-all duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                role="link" tabIndex={0} aria-label={`Otevřít kartu ${member.name}`}
                onKeyDown={event=>{if(isRecordActivation(event)){event.preventDefault();openMember(member.id);}}}
                onClick={event=>{if(isRecordActivation(event))openMember(member.id);}}
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
                            <Button variant="ghost" size="sm" aria-label={`Akce pro zamestnance ${member.name || 'bez jmena'}`} className="h-9 w-9 p-0 text-slate-500 hover:text-slate-900" onClick={(e) => e.stopPropagation()}>
                                <MoreHorizontal className="h-4 w-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openMember(member.id)}>
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
                                    onClick={() => setDeleteCandidate(member)}
                                    className="text-red-600"
                                >
                                    <Trash2 className="h-4 w-4 mr-2" />
                                    Smazat
                                </DropdownMenuItem>
                            )}
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>

                {!financeReady&&canViewFinance&&<p className="mb-3 text-xs text-slate-500">Finanční údaje nejsou dostupné.</p>}
                <div className="space-y-3">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Mail className="w-3 h-3" />
                        <span className="truncate">{member.email || 'Není nastaven'}</span>
                    </div>

                    {canViewFinance && financeReady && (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Clock className="w-3 h-3" />
                            <span>{member.hourly_rate ? `${Number(member.hourly_rate).toLocaleString('cs-CZ')} Kč/h` : 'Nenastavena'}</span>
                        </div>
                    )}

                    {canViewFinance && financeReady && (
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
        <div className="app-page member-directory" aria-busy={loading}>
            <div className="space-y-4">
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
                {(loadError||financeError)&&<div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm"><p>{loadError||financeError}</p><Button variant="outline" disabled={loading} onClick={fetchMembersAndRewards}>Zkusit znovu</Button></div>}
                {/* Stats Cards */}
                <div className="directory-metrics grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <Card>
                        <CardContent className="p-4">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-blue-100 rounded-lg">
                                    <Users className="h-5 w-5 text-blue-600" />
                                </div>
                                <div>
                                    <p className="text-sm text-muted-foreground">Celkem zaměstnanců</p>
                                    <p className="text-2xl font-bold">{loading||loadError?'—':totalMembers}</p>
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
                                    <p className="text-2xl font-bold">{loading||loadError?'—':uniqueRolesCount}</p>
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
                                    <p className={cn("text-2xl font-bold", canViewFinance && "text-orange-600")}>{canViewFinance&&financeReady ? pendingPayouts.toLocaleString('cs-CZ') + ' Kč' : '—'}</p>
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
                                    <p className="text-2xl font-bold text-red-600">{loading||loadError?'—':membersWithExpiredCerts}</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Filters and Search - pouze pro super uživatele */}
                {isSuperUser && (
                    <Card>
                        <CardContent className="p-3">
                            <div className="flex flex-col lg:flex-row gap-4 items-start lg:items-center justify-between">
                                <div className="relative flex-1 w-full max-w-md">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                    <Input
                                        aria-label="Hledat zaměstnance" placeholder="Jméno nebo e-mail…"
                                        className="pl-10"
                                        value={searchTerm}
                                        onChange={(e) => setSearchTerm(e.target.value)}
                                    />
                                </div>

                                <div className="flex flex-wrap gap-2 items-center">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <Filter className="h-4 w-4 text-muted-foreground" />
                                        <Select value={roleFilter} onValueChange={setRoleFilter}>
                                            <SelectTrigger aria-label="Pozice zaměstnance" className="w-[160px]">
                                                <SelectValue placeholder="Všechny pozice" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="all">Všechny pozice</SelectItem>
                                                <SelectItem value="Bez pozice">Bez pozice ({roleCounts['Bez pozice']||0})</SelectItem>
                                                {Array.from(new Set(members.map(m => m.member_roles?.name).filter(Boolean))).map(role => (
                                                    <SelectItem key={role} value={role}>{role}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>

                                        <Select value={certificationFilter} onValueChange={setCertificationFilter}>
                                            <SelectTrigger aria-label="Stav certifikací" className="w-[180px]">
                                                <SelectValue placeholder="Všechny certifikace" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="all">Všechny certifikace</SelectItem>
                                                <SelectItem value="valid">Platné</SelectItem>
                                                <SelectItem value="expired">Expirované</SelectItem>
                                                <SelectItem value="soon">Končí do 30 dnů</SelectItem>
                                                <SelectItem value="none">Bez certifikací</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>

                                    <div className="flex gap-2">
                                        <Button
                                            variant={view === 'grid' ? 'default' : 'outline'}
                                            size="sm"
                                            aria-pressed={view==='grid'} onClick={() => setView('grid')}
                                        >
                                            <LayoutGrid className="w-4 h-4 mr-2" />
                                            Karty
                                        </Button>
                                        <Button
                                            variant={view === 'table' ? 'default' : 'outline'}
                                            size="sm"
                                            aria-pressed={view==='table'} onClick={() => setView('table')}
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

                <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-500"><span role="status">{loading?'Načítám zaměstnance…':loadError?'Seznam není dostupný':`Zobrazeno ${filteredMembers.length} z ${members.length} zaměstnanců`}</span>{(searchTerm||roleFilter!=='all'||certificationFilter!=='all')&&<Button variant="ghost" size="sm" onClick={resetFilters}>Zrušit filtry</Button>}</div>
                {/* Content */}
                {loading ? <div role="status" className="rounded-xl border bg-white p-8 text-center text-slate-500">Načítám zaměstnance…</div> : loadError ? null : filteredMembers.length > 0 ? (
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
                                                {canViewFinance && financeReady && <TableHead>Hodinová sazba</TableHead>}
                                                {canViewFinance && financeReady && <TableHead>Celková odměna</TableHead>}
                                                {canViewFinance && financeReady && <TableHead>Zbývá k vyplacení</TableHead>}
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
                                                        tabIndex={0} aria-label={`Otevřít kartu ${member.name}`}
                                                        onKeyDown={event=>{if(isRecordActivation(event)){event.preventDefault();openMember(member.id);}}}
                                                        onClick={event=>{if(isRecordActivation(event))openMember(member.id);}}
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
                                                        {canViewFinance && financeReady && (
                                                            <TableCell className="font-semibold">
                                                                {member.hourly_rate ? `${Number(member.hourly_rate).toLocaleString('cs-CZ')} Kč` : 'Nenastavena'}
                                                            </TableCell>
                                                        )}
                                                        {canViewFinance && financeReady && <TableCell>{totalReward.toLocaleString('cs-CZ')} Kč</TableCell>}
                                                        {canViewFinance && financeReady && <TableCell className={cn(
                                                            "font-semibold",
                                                            balance > 0 ? "text-green-600" : "text-gray-500"
                                                        )}>
                                                            {balance.toLocaleString('cs-CZ')} Kč
                                                        </TableCell>}
                                                        <TableCell onClick={(e) => e.stopPropagation()}>
                                                            <DropdownMenu>
                                                                <DropdownMenuTrigger asChild>
                                                                    <Button variant="ghost" size="sm" aria-label={`Akce pro zamestnance ${member.name || 'bez jmena'}`} className="h-9 w-9 p-0 text-slate-500 hover:text-slate-900">
                                                                        <MoreHorizontal className="h-4 w-4" />
                                                                    </Button>
                                                                </DropdownMenuTrigger>
                                                                <DropdownMenuContent align="end">
                                                                    <DropdownMenuItem onClick={(e) => { e.stopPropagation(); openMember(member.id); }}>
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
                                                                            onClick={(e) => { e.stopPropagation(); setDeleteCandidate(member); }}
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

                <AlertDialog open={Boolean(deleteCandidate)} onOpenChange={open=>{if(!open&&!deleting)setDeleteCandidate(null);}}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Smazat zaměstnance {deleteCandidate?.name}?</AlertDialogTitle><AlertDialogDescription>Odstranění karty nelze vrátit. Pokud chcete pouze ukončit přístup, upravte účet místo mazání karty.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={deleting}>Ponechat zaměstnance</AlertDialogCancel><Button variant="destructive" disabled={deleting} onClick={()=>handleDeleteMember(deleteCandidate.id)}>{deleting?'Mažu…':'Smazat zaměstnance'}</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>
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
