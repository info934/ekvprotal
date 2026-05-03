import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { FixedSizeList as List } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import {
  Search, Filter, Calendar, Download, RefreshCw,
  Trash2, Edit2, User, Briefcase, FileText,
  CheckCircle, XCircle, AlertTriangle, Clock, HardHat
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { format, startOfMonth, endOfMonth, parseISO, addMonths, subMonths } from 'date-fns';
import { cs } from 'date-fns/locale';
import * as XLSX from 'xlsx';
import AttendanceDialog from './AttendanceDialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useAuth } from '@/contexts/SupabaseAuthContext';

// Row component for react-window
const Row = ({ index, style, data }) => {
  const { items, onEdit, onDelete } = data;
  const record = items[index];

  if (!record) return null;

  const isProject = !!record.project_id;
  const name = isProject ? record.projects?.name : record.realizations?.name;
  const code = isProject ? record.projects?.code : 'REALIZACE';

  return (
    <div style={style} className="px-2 py-1">
      <div className="flex items-center justify-between p-3 bg-white border rounded-lg hover:shadow-sm transition-all h-full">
        <div className="grid grid-cols-12 gap-4 w-full items-center">
          {/* Date & Member */}
          <div className="col-span-3">
            <div className="flex items-center gap-2 font-medium text-slate-900">
              <Calendar className="w-4 h-4 text-slate-500" />
              {format(parseISO(record.date), 'd. M. yyyy')}
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
              <User className="w-3 h-3" />
              {record.members?.name || 'Neznámý'}
            </div>
          </div>

          {/* Project/Realization */}
          <div className="col-span-4">
            <div className="flex items-center gap-2">
              <Badge variant={isProject ? "outline" : "secondary"} className="font-mono text-xs flex items-center gap-1">
                {isProject ? <Briefcase className="w-3 h-3" /> : <HardHat className="w-3 h-3" />}
                {code || '---'}
              </Badge>
              <span className="truncate font-medium text-sm" title={name}>
                {name || 'Bez přiřazení'}
              </span>
            </div>
            {record.description && (
              <div className="text-xs text-muted-foreground mt-1 truncate pl-1 border-l-2 border-slate-200" title={record.description}>
                {record.description}
              </div>
            )}
          </div>

          {/* Hours */}
          <div className="col-span-2 text-right">
            <span className="font-bold text-lg text-slate-700">
              {Number(record.hours).toFixed(1)}
            </span>
            <span className="text-xs text-muted-foreground ml-1">h</span>
          </div>

          {/* Actions */}
          <div className="col-span-3 flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onEdit(record)}
              className="h-8 w-8 p-0"
            >
              <Edit2 className="w-4 h-4 text-slate-500" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onDelete(record)}
              className="h-8 w-8 p-0 hover:bg-red-50 hover:text-red-600"
            >
              <Trash2 className="w-4 h-4 text-red-400" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

const GlobalAttendanceOptimized = () => {
  const { toast } = useToast();
  const { isAdmin } = useAuth();

  // Data State
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState([]);

  // Filter State
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedMember, setSelectedMember] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all'); // 'all', 'project', 'realization'
  const [searchTerm, setSearchTerm] = useState('');

  // Edit/Delete State
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState(null);
  const [deleteDialogRecord, setDeleteDialogRecord] = useState(null);

  // Fetch Filters Data
  useEffect(() => {
    const fetchFilters = async () => {
      const { data } = await supabase.from('members').select('id, name').order('name');
      if (data) setMembers(data);
    };
    fetchFilters();
  }, []);

  // Fetch Records
  const fetchRecords = useCallback(async () => {
    setLoading(true);
    try {
      const start = format(startOfMonth(currentMonth), 'yyyy-MM-dd');
      const end = format(endOfMonth(currentMonth), 'yyyy-MM-dd');

      let query = supabase
        .from('attendance')
        .select(`
          *,
          members:members!attendance_member_id_fkey (id, name),
          projects (id, name, code),
          realizations (id, name)
        `)
        .gte('date', start)
        .lte('date', end)
        .order('date', { ascending: false });

      if (selectedMember !== 'all') {
        query = query.eq('member_id', selectedMember);
      }

      // Basic query, client-side filtering for type is easier with existing structure logic
      const { data, error } = await query;

      if (error) throw error;
      setRecords(data || []);
    } catch (error) {
      console.error('Error fetching attendance:', error);
      toast({ title: 'Chyba při načítání dat', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [currentMonth, selectedMember, toast]);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  // Filter Logic (Client-side search)
  const filteredRecords = useMemo(() => {
    return records.filter(record => {
      // Type Filter
      if (typeFilter === 'project' && !record.project_id) return false;
      if (typeFilter === 'realization' && !record.realizace_id) return false;

      // Search Filter
      if (!searchTerm) return true;
      const searchLower = searchTerm.toLowerCase();
      const itemName = record.projects?.name || record.realizations?.name || '';
      const itemCode = record.projects?.code || '';

      return (
        record.members?.name?.toLowerCase().includes(searchLower) ||
        itemName.toLowerCase().includes(searchLower) ||
        itemCode.toLowerCase().includes(searchLower) ||
        record.description?.toLowerCase().includes(searchLower)
      );
    });
  }, [records, searchTerm, typeFilter]);

  // Stats
  const stats = useMemo(() => {
    const totalHours = filteredRecords.reduce((sum, r) => sum + Number(r.hours), 0);
    const uniqueMembers = new Set(filteredRecords.map(r => r.member_id)).size;
    const projectCount = new Set(filteredRecords.filter(r => r.project_id).map(r => r.project_id)).size;
    const realizationCount = new Set(filteredRecords.filter(r => r.realizace_id).map(r => r.realizace_id)).size;

    return { totalHours, uniqueMembers, projectCount, realizationCount };
  }, [filteredRecords]);

  // Handlers
  const handleEdit = (record) => {
    setEditingRecord(record);
    setIsDialogOpen(true);
  };

  const handleDeleteClick = (record) => {
    setDeleteDialogRecord(record);
  };

  const handleSave = async (formData) => {
    try {
      const isBatchInsert = Array.isArray(formData);
      // Logic handled in Dialog component mostly, just passing data
      const payload = isBatchInsert ? formData : {
        member_id: formData.member_id,
        project_id: formData.project_id,
        realizace_id: formData.realizace_id,
        date: formData.date,
        hours: formData.hours,
        description: formData.description
      };

      let error;
      if (editingRecord) {
        if (isBatchInsert) throw new Error('Nelze hromadně ukládat při úpravě existujícího záznamu.');
        ({ error } = await supabase
          .from('attendance')
          .update(payload)
          .eq('id', editingRecord.id));
      } else {
        ({ error } = await supabase
          .from('attendance')
          .insert(payload));
      }

      if (error) throw error;

      toast({
        title: editingRecord ? 'Záznam aktualizován' : 'Záznam vytvořen',
        className: 'bg-green-100 text-green-800'
      });
      setIsDialogOpen(false);
      setEditingRecord(null);
      fetchRecords();
    } catch (error) {
      toast({
        title: 'Chyba při ukládání',
        description: error.message,
        variant: 'destructive'
      });
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteDialogRecord) return;
    try {
      const { error } = await supabase
        .from('attendance')
        .delete()
        .eq('id', deleteDialogRecord.id);

      if (error) throw error;

      toast({ title: 'Záznam smazán' });
      setDeleteDialogRecord(null);
      fetchRecords();
    } catch (error) {
      toast({
        title: 'Chyba při mazání',
        description: error.message,
        variant: 'destructive'
      });
    }
  };

  const handleExport = () => {
    const dataToExport = filteredRecords.map(r => ({
      Datum: format(parseISO(r.date), 'd.M.yyyy'),
      Zaměstnanec: r.members?.name,
      Typ: r.project_id ? 'Projekt' : 'Realizace',
      Název: r.projects?.name || r.realizations?.name,
      Kód: r.projects?.code || '-',
      Popis: r.description,
      Hodiny: Number(r.hours)
    }));

    const ws = XLSX.utils.json_to_sheet(dataToExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Docházka");
    XLSX.writeFile(wb, `Dochazka_Export_${format(currentMonth, 'yyyy_MM')}.xlsx`);
  };

  return (
    <div className="space-y-6 h-full flex flex-col">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 shrink-0">
        <Card>
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Celkem hodin</p>
              <p className="text-2xl font-bold text-slate-800">{stats.totalHours.toFixed(1)}</p>
            </div>
            <Clock className="w-8 h-8 text-blue-500 opacity-20" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Aktivní lidé</p>
              <p className="text-2xl font-bold text-slate-800">{stats.uniqueMembers}</p>
            </div>
            <User className="w-8 h-8 text-green-500 opacity-20" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Projekty</p>
              <p className="text-2xl font-bold text-slate-800">{stats.projectCount}</p>
            </div>
            <Briefcase className="w-8 h-8 text-purple-500 opacity-20" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Realizace</p>
              <p className="text-2xl font-bold text-slate-800">{stats.realizationCount}</p>
            </div>
            <HardHat className="w-8 h-8 text-orange-500 opacity-20" />
          </CardContent>
        </Card>
      </div>

      {/* Controls */}
      <Card className="shrink-0">
        <CardContent className="p-4 space-y-4">
          <div className="flex flex-col md:flex-row justify-between gap-4 items-center">
            {/* Month Selector */}
            <div className="flex items-center gap-2 bg-slate-100 p-1 rounded-lg">
              <Button variant="ghost" size="icon" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}>
                <code className="text-lg">←</code>
              </Button>
              <span className="font-semibold min-w-[140px] text-center capitalize">
                {format(currentMonth, 'LLLL yyyy', { locale: cs })}
              </span>
              <Button variant="ghost" size="icon" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}>
                <code className="text-lg">→</code>
              </Button>
            </div>

            <div className="flex flex-wrap gap-2 w-full md:w-auto">
              <div className="w-[200px]">
                <Select value={selectedMember} onValueChange={setSelectedMember}>
                  <SelectTrigger>
                    <SelectValue placeholder="Všichni zaměstnanci" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Všichni zaměstnanci</SelectItem>
                    {members.map(m => (
                      <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="w-[200px]">
                <Select value={typeFilter} onValueChange={setTypeFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="Všechny typy" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Všechny typy</SelectItem>
                    <SelectItem value="project">Jen projekty</SelectItem>
                    <SelectItem value="realization">Jen realizace</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <div className="flex flex-col md:flex-row justify-between gap-4">
            <div className="relative w-full md:w-96">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Hledat (projekt, jméno, popis)..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={fetchRecords} disabled={loading}>
                <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                Obnovit
              </Button>
              <Button variant="outline" onClick={handleExport}>
                <Download className="w-4 h-4 mr-2" />
                Export
              </Button>
              <Button onClick={() => { setEditingRecord(null); setIsDialogOpen(true); }}>
                + Přidat záznam
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Virtualized List */}
      <div className="flex-1 bg-slate-50 rounded-lg border min-h-[400px]">
        {loading ? (
          <div className="h-full flex items-center justify-center text-muted-foreground">
            <RefreshCw className="w-6 h-6 animate-spin mr-2" /> Načítání záznamů...
          </div>
        ) : filteredRecords.length > 0 ? (
          <AutoSizer>
            {({ height, width }) => (
              <List
                height={height}
                width={width}
                itemCount={filteredRecords.length}
                itemSize={80}
                itemData={{
                  items: filteredRecords,
                  onEdit: handleEdit,
                  onDelete: handleDeleteClick
                }}
              >
                {Row}
              </List>
            )}
          </AutoSizer>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
            <Search className="w-12 h-12 mb-2 opacity-20" />
            <p>Žádné záznamy k zobrazení</p>
          </div>
        )}
      </div>

      {/* Dialogs */}
      <AttendanceDialog
        isOpen={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
        onSave={handleSave}
        record={editingRecord}
        isAdmin={true}
        memberId={null}
      />

      <AlertDialog open={!!deleteDialogRecord} onOpenChange={() => setDeleteDialogRecord(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Smazat záznam?</AlertDialogTitle>
            <AlertDialogDescription>
              Opravdu chcete smazat záznam docházky?
              <br />
              <strong>{deleteDialogRecord?.members?.name}</strong> - {deleteDialogRecord?.projects?.name || deleteDialogRecord?.realizations?.name} ({Number(deleteDialogRecord?.hours).toFixed(1)}h)
              <br />
              Tato akce je nevratná.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Zrušit</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm} className="bg-destructive hover:bg-destructive/90">
              Smazat
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default GlobalAttendanceOptimized;
