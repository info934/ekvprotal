import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Users, Plus, UserMinus, Edit2, Briefcase, AlertTriangle } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { formatRealizationDate, realizationAssignmentState } from '@/lib/realizationOverview';

const RealizaceTeam = ({ realizaceId }) => {
    const { toast } = useToast();
    const { userRole } = useAuth();
    const [teamMembers, setTeamMembers] = useState([]);
    const [availableMembers, setAvailableMembers] = useState([]);
    const [rewardedMemberIds, setRewardedMemberIds] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(false);
    const [showHistory, setShowHistory] = useState(false);
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
    const [endingAssignment, setEndingAssignment] = useState(null);
    const [assignmentEndDate, setAssignmentEndDate] = useState(new Date().toISOString().slice(0, 10));
    const [assignmentEndReason, setAssignmentEndReason] = useState('');

    // Strictly disable edit for 'user' role
    const canEdit = userRole === 'admin';

    const fetchData = useCallback(async () => {
        setLoading(true);
        setLoadError(false);
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
                    ended_at,
                    ended_reason,
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
              userRole === 'admin'
                ? supabase.from('members').select('id, name, member_roles(name)').order('name')
                : Promise.resolve({ data: [], error: null }),
              userRole === 'admin'
                ? supabase.from('realization_reward_plans').select('member_id').eq('realizace_id', realizaceId)
                : Promise.resolve({ data: [], error: null }),
            ]);
            
            if (membersError) throw membersError;
            if (sharesError) throw sharesError;

            setTeamMembers(teamData || []);
            setAvailableMembers(allMembers || []);
            setRewardedMemberIds((profitShares || []).map((share) => share.member_id));

        } catch (error) {
            setLoadError(true);
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

    const handleEndAssignment = async () => {
        if (!endingAssignment || !assignmentEndDate || !assignmentEndReason.trim()) return;
        setSaving(true);
        try {
            const { error } = await supabase.rpc('end_realization_team_assignment', {
                p_assignment_id: endingAssignment.id,
                p_valid_to: assignmentEndDate,
                p_reason: assignmentEndReason.trim(),
            });
            if (error) throw error;
            toast({
                title: 'Přiřazení bylo ukončeno',
                description: 'Historická docházka, náklady a audit zůstaly zachovány.',
            });
            setEndingAssignment(null);
            setAssignmentEndReason('');
            await fetchData();
        } catch (error) {
            toast({ title: 'Přiřazení se nepodařilo ukončit', description: error.message, variant: 'destructive' });
        } finally {
            setSaving(false);
        }
    };

    const openEndAssignment = (assignment) => {
        setEndingAssignment(assignment);
        setAssignmentEndDate(assignment.valid_to || new Date().toISOString().slice(0, 10));
        setAssignmentEndReason('');
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
        m => !teamMembers.some(tm => tm.member?.id === m.id)
    );

    const currentMembers = teamMembers.filter(item => realizationAssignmentState(item) !== 'ended');
    const historicalMembers = teamMembers.filter(item => realizationAssignmentState(item) === 'ended');
    const visibleMembers = showHistory ? historicalMembers : currentMembers;
    const today = new Date().toISOString().slice(0, 10);
    const sponsorOptions = teamMembers.filter((item) => (
        rewardedMemberIds.includes(item.member?.id)
        && item.member?.id !== selectedMemberId
        && !item.ended_at
        && (!item.valid_to || item.valid_to >= today)
    ));

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
            <CardHeader className="flex flex-col gap-3 pb-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                    <CardTitle className="text-lg flex items-center gap-2">
                        <Users className="w-5 h-5 text-blue-600" /> Členové týmu
                    </CardTitle>
                    <CardDescription>Členové, odpovědnosti a platnost přiřazení.{canEdit ? ' Podíly a odměny jsou ve Financích.' : ' Vlastní odměnu najdete v Přehledu.'}</CardDescription>
                </div>
                {canEdit && (
                    <Button className="min-h-11" size="sm" variant="outline" disabled={loading || loadError} onClick={() => setIsAddOpen(true)}>
                        <Plus className="w-4 h-4 mr-2" /> Přidat člena
                    </Button>
                )}
            </CardHeader>
            <CardContent className="flex-1">
                <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Platnost členů týmu">
                    <Button variant={!showHistory ? 'secondary' : 'ghost'} className="min-h-11" aria-pressed={!showHistory} onClick={() => setShowHistory(false)}>Aktuální a plánovaní ({currentMembers.length})</Button>
                    <Button variant={showHistory ? 'secondary' : 'ghost'} className="min-h-11" aria-pressed={showHistory} onClick={() => setShowHistory(true)}>Historie ({historicalMembers.length})</Button>
                </div>

                {loading ? (
                    <div className="text-center py-4 text-muted-foreground">Načítání týmu...</div>
                ) : loadError ? (
                    <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Tým se nepodařilo načíst. <Button variant="link" onClick={fetchData}>Zkusit znovu</Button></div>
                ) : visibleMembers.length === 0 ? (
                    <div className="text-center py-8 bg-slate-50 rounded-lg border border-dashed">
                        <Users className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
                        <p className="text-sm text-muted-foreground">{showHistory ? 'Žádná ukončená přiřazení.' : 'Realizace zatím nemá aktivní ani plánované členy týmu.'}</p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {visibleMembers.map((item) => (
                            <div key={item.id} className="flex min-w-0 flex-col gap-3 rounded-lg border bg-card p-4 sm:flex-row sm:items-start sm:justify-between">
                                <div className="flex min-w-0 gap-3">
                                    <Avatar>
                                        <AvatarImage src={item.member?.avatar_url} />
                                        <AvatarFallback>{item.member?.name?.charAt(0) || '?'}</AvatarFallback>
                                    </Avatar>
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2 break-words font-medium">
                                            {item.member?.name || 'Člen není dostupný'}
                                            {item.member?.member_roles?.name && (
                                                <Badge variant="secondary" className="text-[10px] h-5">
                                                    {item.member.member_roles.name}
                                                </Badge>
                                            )}
                                        </div>
                                        {item.responsibility ? (
                                            <div className="text-sm text-blue-700 mt-1 flex items-start gap-1.5 bg-blue-50 px-2 py-1 rounded w-fit">
                                                <Briefcase className="w-3 h-3 mt-0.5 shrink-0" />
                                                <span className="whitespace-pre-wrap break-words">{item.responsibility}</span>
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
                                        <div className="mt-1 text-xs text-muted-foreground">
                                            Platnost: {formatRealizationDate(item.valid_from)} – {formatRealizationDate(item.valid_to, 'bez omezení')}
                                        </div>
                                        {realizationAssignmentState(item) !== 'active' && (
                                            <Badge variant="outline" className="mt-2 border-slate-300 text-slate-600">
                                                {realizationAssignmentState(item) === 'planned' ? 'Plánované přiřazení' : 'Platnost skončila'}
                                            </Badge>
                                        )}
                                    </div>
                                </div>
                                
                                {canEdit && (
                                    <div className="flex items-center gap-1">
                                        {!item.ended_at && (
                                            <Button variant="ghost" size="icon" className="h-11 w-11" aria-label={`Upravit přiřazení: ${item.member?.name || 'člen'}`} onClick={() => openEdit(item)}>
                                                <Edit2 className="w-4 h-4 text-muted-foreground hover:text-foreground" />
                                            </Button>
                                        )}
                                        {!item.ended_at && (
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-11 w-11 text-amber-600 hover:bg-amber-50 hover:text-amber-700"
                                                aria-label={`Ukončit přiřazení: ${item.member?.name || 'člen'}`}
                                                onClick={() => openEndAssignment(item)}
                                                title="Ukončit platnost přiřazení"
                                            >
                                                <UserMinus className="w-4 h-4" />
                                            </Button>
                                        )}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </CardContent>

            <AlertDialog
                open={Boolean(endingAssignment)}
                onOpenChange={(open) => {
                    if (!open && !saving) {
                        setEndingAssignment(null);
                        setAssignmentEndReason('');
                    }
                }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle className="flex items-center gap-2">
                            <AlertTriangle className="h-5 w-5 text-amber-600" />
                            Ukončit platnost přiřazení
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            Člen nebude smazán. Budoucí docházku po koncovém datu nebude možné k tomuto
                            přiřazení zaúčtovat; již zaúčtované hodiny, náklady, odměny a audit zůstanou beze změny.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <div className="space-y-4 py-2">
                        <div className="rounded-md border bg-slate-50 p-3 text-sm">
                            <div className="font-medium">{endingAssignment?.member?.name}</div>
                            <div className="text-muted-foreground">{endingAssignment?.responsibility || 'Bez popisu odpovědnosti'}</div>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="assignment-end-date">Poslední den platnosti</Label>
                            <Input
                                id="assignment-end-date"
                                type="date"
                                min={endingAssignment?.valid_from || undefined}
                                value={assignmentEndDate}
                                onChange={(event) => setAssignmentEndDate(event.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="assignment-end-reason">Důvod ukončení</Label>
                            <Textarea
                                id="assignment-end-reason"
                                value={assignmentEndReason}
                                onChange={(event) => setAssignmentEndReason(event.target.value)}
                                placeholder="Např. dokončení přidělené části, změna odpovědnosti..."
                                rows={3}
                            />
                        </div>
                    </div>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={saving}>Zrušit</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={(event) => {
                                event.preventDefault();
                                handleEndAssignment();
                            }}
                            disabled={saving || !assignmentEndDate || !assignmentEndReason.trim()}
                            className="bg-amber-600 hover:bg-amber-700"
                        >
                            {saving ? 'Ukončuji...' : 'Ukončit přiřazení'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Add Member Dialog */}
            <Dialog open={isAddOpen} onOpenChange={(open) => { setIsAddOpen(open); if(!open) resetForm(); }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Přidat člena týmu</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
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
