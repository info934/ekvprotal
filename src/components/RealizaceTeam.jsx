import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Users, Plus, Trash2, Edit2, Briefcase, Coins } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { formatCurrency } from '@/lib/utils';

const RealizaceTeam = ({ realizaceId, teamBudget }) => {
    const { toast } = useToast();
    const { userRole } = useAuth();
    const [teamMembers, setTeamMembers] = useState([]);
    const [availableMembers, setAvailableMembers] = useState([]);
    const [rewardedMemberIds, setRewardedMemberIds] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isAddOpen, setIsAddOpen] = useState(false);
    const [isEditOpen, setIsEditOpen] = useState(false);
    
    // Form states
    const [selectedMemberId, setSelectedMemberId] = useState('');
    const [responsibility, setResponsibility] = useState('');
    const [editingId, setEditingId] = useState(null);
    const [isHourly, setIsHourly] = useState(false);
    const [fundingMode, setFundingMode] = useState('direct_project');
    const [sponsorMemberId, setSponsorMemberId] = useState('');
    const [sponsorPercent, setSponsorPercent] = useState('100');
    const [validFrom, setValidFrom] = useState(new Date().toISOString().slice(0, 10));
    const [validTo, setValidTo] = useState('');
    const [saving, setSaving] = useState(false);

    // Strictly disable edit for 'user' role
    const canEdit = userRole === 'admin';

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            // Fetch current team
            const { data: teamData, error: teamError } = await supabase
                .from('realizace_team_members')
                .select(`
                    id,
                    responsibility,
                    is_hourly,
                    valid_from,
                    valid_to,
                    hourly_funding_mode,
                    hourly_sponsor_member_id,
                    hourly_sponsor_percent,
                    member:members!realizace_team_members_member_id_fkey (
                        id,
                        name,
                        email,
                        avatar_url,
                        member_roles (name)
                    )
                `)
                .eq('realizace_id', realizaceId);

            if (teamError) throw teamError;

            // Fetch all members for selection
            const [{ data: allMembers, error: membersError }, { data: profitShares, error: sharesError }] = await Promise.all([
              supabase
                .from('members')
                .select('id, name, member_roles(name)')
                .order('name'),
              userRole === 'admin'
                ? supabase.from('realization_profit_shares').select('member_id').eq('realizace_id', realizaceId)
                : Promise.resolve({ data: [], error: null }),
            ]);
            
            if (membersError) throw membersError;
            if (sharesError) throw sharesError;

            setTeamMembers(teamData || []);
            setAvailableMembers(allMembers || []);
            setRewardedMemberIds((profitShares || []).map((share) => share.member_id));

        } catch (error) {
            console.error('Error fetching team:', error);
            toast({ title: 'Chyba při načítání týmu', description: error.message, variant: 'destructive' });
        } finally {
            setLoading(false);
        }
    }, [realizaceId, toast, userRole]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const handleAddMember = async () => {
        if (!selectedMemberId) return;
        if (isHourly && fundingMode === 'member_reward' && !sponsorMemberId) {
            toast({ title: 'Chybí financující člen', description: 'Vyberte člena s podílem na realizaci.', variant: 'destructive' });
            return;
        }
        setSaving(true);
        try {
            const { error } = await supabase.from('realizace_team_members').insert({
                realizace_id: realizaceId,
                member_id: selectedMemberId,
                responsibility,
                is_hourly: isHourly,
                valid_from: validFrom,
                valid_to: validTo || null,
                hourly_funding_mode: isHourly ? fundingMode : 'direct_project',
                hourly_sponsor_member_id: isHourly && fundingMode === 'member_reward' ? sponsorMemberId : null,
                hourly_sponsor_percent: isHourly && fundingMode === 'member_reward' ? Number(sponsorPercent || 100) : 0,
            });

            if (error) throw error;

            toast({ title: 'Člen týmu přidán' });
            setIsAddOpen(false);
            resetForm();
            fetchData();
        } catch (error) {
            toast({ title: 'Chyba', description: error.message, variant: 'destructive' });
        } finally {
            setSaving(false);
        }
    };

    const handleEditMember = async () => {
        if (!editingId) return;
        if (isHourly && fundingMode === 'member_reward' && !sponsorMemberId) {
            toast({ title: 'Chybí financující člen', description: 'Vyberte člena s podílem na realizaci.', variant: 'destructive' });
            return;
        }
        setSaving(true);
        try {
            const { error } = await supabase
                .from('realizace_team_members')
                .update({
                    responsibility,
                    is_hourly: isHourly,
                    valid_from: validFrom,
                    valid_to: validTo || null,
                    hourly_funding_mode: isHourly ? fundingMode : 'direct_project',
                    hourly_sponsor_member_id: isHourly && fundingMode === 'member_reward' ? sponsorMemberId : null,
                    hourly_sponsor_percent: isHourly && fundingMode === 'member_reward' ? Number(sponsorPercent || 100) : 0,
                })
                .eq('id', editingId);

            if (error) throw error;

            toast({ title: 'Odpovědnost aktualizována' });
            setIsEditOpen(false);
            resetForm();
            fetchData();
        } catch (error) {
            toast({ title: 'Chyba', description: error.message, variant: 'destructive' });
        } finally {
            setSaving(false);
        }
    };

    const handleDeleteMember = async (id) => {
        try {
            const { error } = await supabase.from('realizace_team_members').delete().eq('id', id);
            if (error) throw error;
            toast({ title: 'Člen týmu odebrán' });
            fetchData();
        } catch (error) {
            toast({ title: 'Chyba', description: error.message, variant: 'destructive' });
        }
    };

    const openEdit = (member) => {
        setEditingId(member.id);
        setSelectedMemberId(member.member?.id || '');
        setResponsibility(member.responsibility || '');
        setIsHourly(member.is_hourly || false);
        setFundingMode(member.hourly_funding_mode || 'direct_project');
        setSponsorMemberId(member.hourly_sponsor_member_id || '');
        setSponsorPercent(String(member.hourly_sponsor_percent ?? 100));
        setValidFrom(member.valid_from || new Date().toISOString().slice(0, 10));
        setValidTo(member.valid_to || '');
        setIsEditOpen(true);
    };

    const resetForm = () => {
        setSelectedMemberId('');
        setResponsibility('');
        setEditingId(null);
        setIsHourly(false);
        setFundingMode('direct_project');
        setSponsorMemberId('');
        setSponsorPercent('100');
        setValidFrom(new Date().toISOString().slice(0, 10));
        setValidTo('');
    };

    // Filter out members already in the team
    const selectableMembers = availableMembers.filter(
        m => !teamMembers.some(tm => tm.member.id === m.id)
    );

    const isBudgetPositive = teamBudget >= 0;
    const sponsorOptions = teamMembers.filter((item) => rewardedMemberIds.includes(item.member?.id) && item.member?.id !== selectedMemberId);

    const renderLaborFields = () => (
        <div className="space-y-3 rounded-lg border bg-slate-50 p-3">
            <div className="flex items-center gap-2">
                <Checkbox id="realization-is-hourly" checked={isHourly} onCheckedChange={(checked) => setIsHourly(Boolean(checked))} />
                <Label htmlFor="realization-is-hourly">Hodinová práce a docházka</Label>
            </div>
            {isHourly && (
                <>
                    <div className="space-y-2">
                        <Label>Zdroj hodinového nákladu</Label>
                        <Select value={fundingMode} onValueChange={(value) => { setFundingMode(value); if (value === 'direct_project') setSponsorMemberId(''); }}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="direct_project">Přímo z rozpočtu realizace</SelectItem>
                                <SelectItem value="member_reward">Z podílu člena týmu</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    {fundingMode === 'member_reward' && (
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_130px]">
                            <div className="space-y-2">
                                <Label>Financující člen s podílem</Label>
                                <Select value={sponsorMemberId} onValueChange={setSponsorMemberId}>
                                    <SelectTrigger><SelectValue placeholder="Vyberte člena" /></SelectTrigger>
                                    <SelectContent>{sponsorOptions.map((item) => <SelectItem key={item.member.id} value={item.member.id}>{item.member.name}</SelectItem>)}</SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Podíl (%)</Label>
                                <Input type="number" min="0" max="100" step="0.01" value={sponsorPercent} onChange={(event) => setSponsorPercent(event.target.value)} className="text-right" />
                            </div>
                        </div>
                    )}
                </>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-2"><Label>Platnost od</Label><Input type="date" value={validFrom} onChange={(event) => setValidFrom(event.target.value)} /></div>
                <div className="space-y-2"><Label>Platnost do</Label><Input type="date" value={validTo} onChange={(event) => setValidTo(event.target.value)} /></div>
            </div>
        </div>
    );

    return (
        <Card className="h-full flex flex-col">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
                <div>
                    <CardTitle className="text-lg flex items-center gap-2">
                        <Users className="w-5 h-5 text-blue-600" /> Členové týmu
                    </CardTitle>
                    <CardDescription>Správa týmu a odpovědností</CardDescription>
                </div>
                {canEdit && (
                    <Button size="sm" variant="outline" onClick={() => setIsAddOpen(true)}>
                        <Plus className="w-4 h-4 mr-2" /> Přidat
                    </Button>
                )}
            </CardHeader>
            <CardContent className="flex-1">
                {teamBudget !== undefined && (
                     <div className={`mb-4 p-2 rounded-md border flex items-center justify-between ${isBudgetPositive ? 'bg-blue-50 border-blue-100' : 'bg-red-50 border-red-100'}`}>
                         <span className={`text-xs font-medium flex items-center gap-1 ${isBudgetPositive ? 'text-blue-700' : 'text-red-700'}`}>
                             <Coins className="w-3 h-3"/> Týmový rozpočet:
                         </span>
                         <span className={`text-sm font-bold ${isBudgetPositive ? 'text-blue-800' : 'text-red-800'}`}>
                            {formatCurrency(teamBudget)}
                         </span>
                     </div>
                )}

                {loading ? (
                    <div className="text-center py-4 text-muted-foreground">Načítání týmu...</div>
                ) : teamMembers.length === 0 ? (
                    <div className="text-center py-8 bg-slate-50 rounded-lg border border-dashed">
                        <Users className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
                        <p className="text-sm text-muted-foreground">Zatím nebyli přiřazeni žádní členové týmu.</p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {teamMembers.map((item) => (
                            <div key={item.id} className="flex items-start justify-between p-3 rounded-lg border bg-card hover:bg-accent/5 transition-colors">
                                <div className="flex gap-3">
                                    <Avatar>
                                        <AvatarImage src={item.member?.avatar_url} />
                                        <AvatarFallback>{item.member?.name?.charAt(0) || '?'}</AvatarFallback>
                                    </Avatar>
                                    <div>
                                        <div className="font-medium flex items-center gap-2">
                                            {item.member?.name}
                                            {item.member?.member_roles?.name && (
                                                <Badge variant="secondary" className="text-[10px] h-5">
                                                    {item.member.member_roles.name}
                                                </Badge>
                                            )}
                                        </div>
                                        {item.responsibility ? (
                                            <div className="text-sm text-blue-700 mt-1 flex items-start gap-1.5 bg-blue-50 px-2 py-1 rounded w-fit">
                                                <Briefcase className="w-3 h-3 mt-0.5 shrink-0" />
                                                <span className="whitespace-pre-wrap">{item.responsibility}</span>
                                            </div>
                                        ) : (
                                            <div className="text-sm text-muted-foreground italic mt-1">
                                                Bez specifické odpovědnosti
                                            </div>
                                        )}
                                        {item.is_hourly && (
                                            <div className="mt-2 text-xs text-muted-foreground">
                                                {item.hourly_funding_mode === 'member_reward'
                                                    ? `Hodinová práce z podílu člena (${Number(item.hourly_sponsor_percent || 0).toLocaleString('cs-CZ')} %)`
                                                    : 'Hodinová práce z rozpočtu realizace'}
                                            </div>
                                        )}
                                    </div>
                                </div>
                                
                                {canEdit && (
                                    <div className="flex items-center gap-1">
                                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(item)}>
                                            <Edit2 className="w-4 h-4 text-muted-foreground hover:text-foreground" />
                                        </Button>
                                        <AlertDialog>
                                            <AlertDialogTrigger asChild>
                                                <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500 hover:text-red-700 hover:bg-red-50">
                                                    <Trash2 className="w-4 h-4" />
                                                </Button>
                                            </AlertDialogTrigger>
                                            <AlertDialogContent>
                                                <AlertDialogHeader>
                                                    <AlertDialogTitle>Odebrat člena z týmu?</AlertDialogTitle>
                                                </AlertDialogHeader>
                                                <AlertDialogFooter>
                                                    <AlertDialogCancel>Zrušit</AlertDialogCancel>
                                                    <AlertDialogAction onClick={() => handleDeleteMember(item.id)} className="bg-destructive">Odebrat</AlertDialogAction>
                                                </AlertDialogFooter>
                                            </AlertDialogContent>
                                        </AlertDialog>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </CardContent>

            {/* Add Member Dialog */}
            <Dialog open={isAddOpen} onOpenChange={(open) => { setIsAddOpen(open); if(!open) resetForm(); }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Přidat člena týmu</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className={`p-3 rounded-md mb-2 flex items-center justify-between ${isBudgetPositive ? 'bg-blue-50 border border-blue-100' : 'bg-red-50 border border-red-100'}`}>
                            <span className="text-sm font-medium">Dostupný týmový rozpočet:</span>
                            <span className={`font-bold ${isBudgetPositive ? 'text-blue-700' : 'text-red-700'}`}>{formatCurrency(teamBudget)}</span>
                        </div>
                        <div className="space-y-2">
                            <Label>Člen týmu</Label>
                            <Select value={selectedMemberId} onValueChange={setSelectedMemberId}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Vyberte člena..." />
                                </SelectTrigger>
                                <SelectContent>
                                    {selectableMembers.map(m => (
                                        <SelectItem key={m.id} value={m.id}>
                                            {m.name} <span className="text-muted-foreground text-xs">({m.member_roles?.name || 'Bez role'})</span>
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>Odpovědnost / Úkol</Label>
                            <Textarea 
                                value={responsibility} 
                                onChange={e => setResponsibility(e.target.value)} 
                                placeholder="Např. Stavební dozor, koordinace subdodavatelů..." 
                                rows={3}
                            />
                        </div>
                        {renderLaborFields()}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsAddOpen(false)}>Zrušit</Button>
                        <Button onClick={handleAddMember} disabled={!selectedMemberId || saving}>
                            {saving ? 'Ukládání...' : 'Přidat'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Edit Responsibility Dialog */}
            <Dialog open={isEditOpen} onOpenChange={(open) => { setIsEditOpen(open); if(!open) resetForm(); }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Upravit odpovědnost</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                         <div className={`p-3 rounded-md mb-2 flex items-center justify-between ${isBudgetPositive ? 'bg-blue-50 border border-blue-100' : 'bg-red-50 border border-red-100'}`}>
                            <span className="text-sm font-medium">Dostupný týmový rozpočet:</span>
                            <span className={`font-bold ${isBudgetPositive ? 'text-blue-700' : 'text-red-700'}`}>{formatCurrency(teamBudget)}</span>
                        </div>
                        <div className="space-y-2">
                            <Label>Odpovědnost / Úkol</Label>
                            <Textarea 
                                value={responsibility} 
                                onChange={e => setResponsibility(e.target.value)} 
                                placeholder="Např. Stavební dozor, koordinace subdodavatelů..." 
                                rows={4}
                            />
                        </div>
                        {renderLaborFields()}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsEditOpen(false)}>Zrušit</Button>
                        <Button onClick={handleEditMember} disabled={saving}>
                            {saving ? 'Ukládání...' : 'Uložit změny'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Card>
    );
};

export default RealizaceTeam;
