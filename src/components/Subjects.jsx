import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Link, useNavigate } from 'react-router-dom';
import {
  Plus, Building, Search, Filter, List, LayoutGrid, AlertTriangle, RefreshCw,
  MoreHorizontal, Edit, Trash2, ChevronLeft, ChevronRight, Factory, Home, User2,
  Phone, Settings, Download, Mail, MapPin, Hash, Users
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import SubjectDialog from '@/components/SubjectDialog';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from '@/lib/utils';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuCheckboxItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import * as XLSX from 'xlsx';
import PageHeader from '@/components/ui/page-header';

const subjectTypeConfig = {
  customer: { label: 'Zákazník', icon: User2, color: 'text-emerald-700', surface: 'bg-emerald-50 ring-emerald-100', badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  supplier: { label: 'Dodavatel', icon: Factory, color: 'text-blue-700', surface: 'bg-blue-50 ring-blue-100', badgeClass: 'bg-blue-50 text-blue-700 border-blue-200' },
  investor: { label: 'Investor', icon: Home, color: 'text-violet-700', surface: 'bg-violet-50 ring-violet-100', badgeClass: 'bg-violet-50 text-violet-700 border-violet-200' },
  authority: { label: 'Úřad', icon: Building, color: 'text-amber-700', surface: 'bg-amber-50 ring-amber-100', badgeClass: 'bg-amber-50 text-amber-700 border-amber-200' },
  other: { label: 'Ostatní', icon: User2, color: 'text-slate-700', surface: 'bg-slate-50 ring-slate-100', badgeClass: 'bg-slate-50 text-slate-700 border-slate-200' },
};

const allColumns = {
  name: { label: 'Název subjektu', default: true },
  ico: { label: 'IČO', default: true },
  type: { label: 'Typ', default: true },
  contact_person: { label: 'Kontaktní osoba', default: true },
  email: { label: 'Email', default: false },
  phone: { label: 'Telefon', default: false },
  address: { label: 'Adresa', default: false },
  region: { label: 'Region', default: false },
};

const SubjectTypeBadge = ({ typeName }) => {
  const config = subjectTypeConfig[typeName] || subjectTypeConfig.other;
  return (
    <Badge variant="outline" className={cn("whitespace-nowrap", config.badgeClass)}>
      {config.label}
    </Badge>
  );
};

const SubjectSummaryCard = ({ typeKey, count, total }) => {
  const config = subjectTypeConfig[typeKey] || subjectTypeConfig.other;
  const Icon = config.icon;
  const share = total > 0 ? Math.round((count / total) * 100) : 0;

  return (
    <Card className="overflow-hidden">
      <CardContent className="flex items-center gap-4 p-4">
        <div className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-md ring-1", config.surface, config.color)}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-muted-foreground">{config.label}</p>
          <div className="mt-1 flex items-end justify-between gap-3">
            <p className="text-2xl font-semibold tracking-tight text-slate-950">{count}</p>
            <span className="text-xs text-muted-foreground">{share} %</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

const SubjectCard = ({ subject, onClick }) => {
  const navigate = useNavigate();
  const handleCardClick = () => navigate(`/subjects/${subject.id}`);
  const config = subjectTypeConfig[subject.subject_types?.name] || subjectTypeConfig['other'];
  const Icon = config.icon;

  return (
    <motion.div
      layout
      layoutId={`card-${subject.id}`}
      onClick={handleCardClick}
      className="group relative cursor-pointer overflow-hidden rounded-lg border bg-white p-4 shadow-sm transition-all duration-200 hover:border-primary/40 hover:shadow-md"
    >
      <div className={cn("absolute inset-x-0 top-0 h-1", config.color.replace('text', 'bg'))} />
      <div className="mb-4 flex items-start justify-between gap-3 pt-1">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Icon className={cn("h-4 w-4 shrink-0", config.color)} />
            <h3 className="truncate text-sm font-semibold text-slate-950">{subject.name}</h3>
          </div>
          {subject.ico && (
            <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Hash className="h-3.5 w-3.5" />
              <span>{subject.ico}</span>
            </div>
          )}
        </div>
        <SubjectTypeBadge typeName={subject.subject_types?.name} />
      </div>
      <div className="space-y-2.5 text-sm">
        {subject.contact_person && (
          <div className="flex min-w-0 items-center gap-2 text-muted-foreground">
            <User2 className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{subject.contact_person}</span>
          </div>
        )}
        {subject.email && (
          <div className="flex min-w-0 items-center gap-2 text-muted-foreground">
            <Mail className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{subject.email}</span>
          </div>
        )}
        {subject.phone && (
          <div className="flex min-w-0 items-center gap-2 text-muted-foreground">
            <Phone className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{subject.phone}</span>
          </div>
        )}
        {subject.region && (
          <div className="flex min-w-0 items-center gap-2 text-muted-foreground">
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{subject.region}</span>
          </div>
        )}
      </div>
    </motion.div>
  );
};

const SubjectTable = ({ subjects, visibleColumns, sortConfig, requestSort, onSelectSubject, selectedSubjects, onSelectAll, onEditSubject, onDeleteSubject, hasPermission }) => {
  const navigate = useNavigate();

  const handleRowClick = (subjectId, event) => {
    if (event.target.closest('input[type="checkbox"]') || event.target.closest('button')) {
      return;
    }
    navigate(`/subjects/${subjectId}`);
  };

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b bg-slate-50/70 pb-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-base">Adresář subjektů</CardTitle>
            <CardDescription>{subjects.length} položek v aktuálním zobrazení</CardDescription>
          </div>
          {selectedSubjects.size > 0 && (
            <Badge variant="secondary">{selectedSubjects.size} vybráno</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">
                  <Checkbox
                    checked={selectedSubjects.size === subjects.length && subjects.length > 0}
                    onCheckedChange={onSelectAll}
                  />
                </TableHead>
                {Object.entries(allColumns).map(([key, { label }]) =>
                  visibleColumns[key] && (
                    <TableHead key={key} onClick={() => requestSort(key)} className="cursor-pointer whitespace-nowrap hover:bg-slate-100">
                      {label}
                      {sortConfig.key === key ? (sortConfig.direction === 'ascending' ? ' ↑' : ' ↓') : ''}
                    </TableHead>
                  )
                )}
                <TableHead className="w-12 text-right">Akce</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {subjects.map((subject) => {
                const isSelected = selectedSubjects.has(subject.id);
                const config = subjectTypeConfig[subject.subject_types?.name] || subjectTypeConfig['other'];
                const Icon = config.icon;

                return (
                  <TableRow
                    key={subject.id}
                    className={cn(
                      "cursor-pointer hover:bg-slate-50/80",
                      isSelected && "bg-blue-50"
                    )}
                    onClick={(e) => handleRowClick(subject.id, e)}
                  >
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => onSelectSubject(subject.id)}
                      />
                    </TableCell>
                    {visibleColumns.name && (
                      <TableCell className="min-w-[240px]">
                        <div className="flex min-w-0 items-center gap-2">
                          <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-md ring-1", config.surface, config.color)}>
                            <Icon className="h-4 w-4" />
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-slate-950">{subject.name}</p>
                            {subject.region && <p className="truncate text-xs text-muted-foreground">{subject.region}</p>}
                          </div>
                        </div>
                      </TableCell>
                    )}
                    {visibleColumns.ico && <TableCell className="text-sm">{subject.ico}</TableCell>}
                    {visibleColumns.type && (
                      <TableCell>
                        <SubjectTypeBadge typeName={subject.subject_types?.name} />
                      </TableCell>
                    )}
                    {visibleColumns.contact_person && <TableCell className="min-w-[160px] text-sm">{subject.contact_person || '-'}</TableCell>}
                    {visibleColumns.email && <TableCell className="min-w-[200px] text-sm">{subject.email || '-'}</TableCell>}
                    {visibleColumns.phone && <TableCell className="min-w-[140px] text-sm">{subject.phone || '-'}</TableCell>}
                    {visibleColumns.address && <TableCell className="min-w-[240px] text-sm">{subject.address || '-'}</TableCell>}
                    {visibleColumns.region && <TableCell className="min-w-[140px] text-sm">{subject.region || '-'}</TableCell>}
                    <TableCell onClick={(e) => e.stopPropagation()} className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontal className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {hasPermission('subjects', 'can_edit') && (
                            <DropdownMenuItem onClick={() => onEditSubject(subject)}>
                              <Edit className="w-4 h-4 mr-2" /> Upravit
                            </DropdownMenuItem>
                          )}
                          {hasPermission('subjects', 'can_admin') && (
                            <DropdownMenuItem onClick={() => onDeleteSubject(subject.id)} className="text-red-600">
                              <Trash2 className="w-4 h-4 mr-2" /> Smazat
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
      </CardContent>
    </Card>
  );
};


const Subjects = () => {
  const { toast } = useToast();
  const { hasPermission } = useAuth();
  const [subjects, setSubjects] = useState([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingSubject, setEditingSubject] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [view, setView] = useState('table'); // 'kanban' or 'table'
  const [sortConfig, setSortConfig] = useState({ key: 'name', direction: 'ascending' });
  const [selectedSubjects, setSelectedSubjects] = useState(new Set());
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);
  const [loading, setLoading] = useState(false);

  const [visibleColumns, setVisibleColumns] = useState(() => {
    try {
      const saved = localStorage.getItem('subject_visible_columns');
      if (saved) {
        const parsed = JSON.parse(saved);
        const validColumns = {};
        for (const key in allColumns) {
          validColumns[key] = parsed.hasOwnProperty(key) ? parsed[key] : allColumns[key].default;
        }
        return validColumns;
      }
    } catch (error) {
      console.error("Could not parse localStorage item", error);
    }
    return Object.keys(allColumns).reduce((acc, key) => ({ ...acc, [key]: allColumns[key].default }), {});
  });

  useEffect(() => {
    localStorage.setItem('subject_visible_columns', JSON.stringify(visibleColumns));
  }, [visibleColumns]);

  const fetchSubjects = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('subjects')
      .select(`*, subject_types(name)`)
      .order('name', { ascending: true });

    if (error) {
      toast({ title: 'Chyba při načítání subjektů', description: error.message, variant: 'destructive' });
    } else {
      setSubjects(data);
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => {
    fetchSubjects();
  }, [fetchSubjects]);

  const handleSaveSubject = async (data) => {
    if (editingSubject) {
      const { error } = await supabase.from('subjects').update(data).eq('id', editingSubject.id);
      if (error) {
        toast({ title: 'Chyba při úpravě subjektu', description: error.message, variant: 'destructive' });
      } else {
        toast({ title: '✅ Subjekt úspěšně upraven!' });
        fetchSubjects();
      }
    } else {
      const { error } = await supabase.from('subjects').insert([data]);
      if (error) {
        toast({ title: 'Chyba při ukládání subjektu', description: error.message, variant: 'destructive' });
      } else {
        toast({ title: '✅ Subjekt úspěšně vytvořen!' });
        fetchSubjects();
      }
    }
    setIsDialogOpen(false);
    setEditingSubject(null);
  };

  const handleEditSubject = (subject) => {
    setEditingSubject(subject);
    setIsDialogOpen(true);
  };

  const handleDeleteSubject = async (id) => {
    if (!hasPermission('subjects', 'can_admin')) {
      toast({ title: 'Nedostatečná oprávnění', description: 'Nemáte oprávnění mazat subjekty.', variant: 'destructive' });
      return;
    }
    const { error } = await supabase.from('subjects').delete().eq('id', id);
    if (error) {
      toast({ title: 'Chyba při mazání subjektu', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: '🗑️ Subjekt smazán' });
      fetchSubjects();
      setSelectedSubjects(new Set());
    }
  };

  useEffect(() => {
    setCurrentPage(1);
    setSelectedSubjects(new Set());
  }, [searchTerm, typeFilter, sortConfig]);

  const filteredSubjects = subjects.filter(subject => {
    const lowerSearch = searchTerm.toLowerCase();
    const typeMatch = typeFilter === 'all' || subject.subject_types?.name === typeFilter;
    const searchMatch =
      subject.name.toLowerCase().includes(lowerSearch) ||
      subject.ico.toLowerCase().includes(lowerSearch) ||
      (subject.contact_person && subject.contact_person.toLowerCase().includes(lowerSearch)) ||
      (subject.email && subject.email.toLowerCase().includes(lowerSearch)) ||
      (subject.phone && subject.phone.toLowerCase().includes(lowerSearch)) ||
      (subject.address && subject.address.toLowerCase().includes(lowerSearch));
    return typeMatch && searchMatch;
  });

  const sortedSubjects = React.useMemo(() => {
    let sortableItems = [...filteredSubjects];
    if (sortConfig.key !== null) {
      sortableItems.sort((a, b) => {
        let aValue = a[sortConfig.key];
        let bValue = b[sortConfig.key];
        if (sortConfig.key === 'type') { aValue = a.subject_types?.name; bValue = b.subject_types?.name; }

        if (aValue == null) return 1;
        if (bValue == null) return -1;

        if (typeof aValue === 'string' && typeof bValue === 'string') {
          return sortConfig.direction === 'ascending' ? aValue.localeCompare(bValue) : bValue.localeCompare(aValue);
        }
        return sortConfig.direction === 'ascending' ? aValue - bValue : bValue - aValue;
      });
    }
    return sortableItems;
  }, [filteredSubjects, sortConfig]);

  const subjectTypeCounts = React.useMemo(() => {
    return subjects.reduce((acc, subject) => {
      const type = subject.subject_types?.name || 'other';
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    }, {});
  }, [subjects]);

  const subjectsWithContact = React.useMemo(() => {
    return subjects.filter((subject) => subject.email || subject.phone || subject.contact_person).length;
  }, [subjects]);

  const hasActiveFilters = searchTerm.trim() !== '' || typeFilter !== 'all';

  const requestSort = (key) => {
    let direction = 'ascending';
    if (sortConfig.key === key && sortConfig.direction === 'ascending') direction = 'descending';
    setSortConfig({ key, direction });
  };

  const handleSelectSubject = (subjectId) => {
    const newSelected = new Set(selectedSubjects);
    if (newSelected.has(subjectId)) newSelected.delete(subjectId);
    else newSelected.add(subjectId);
    setSelectedSubjects(newSelected);
  };

  const handleSelectAll = () => {
    if (selectedSubjects.size === paginatedSubjects.length) setSelectedSubjects(new Set());
    else setSelectedSubjects(new Set(paginatedSubjects.map(s => s.id)));
  };

  const totalPages = Math.ceil(sortedSubjects.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedSubjects = sortedSubjects.slice(startIndex, endIndex);

  const handlePageChange = (page) => {
    setCurrentPage(page);
    setSelectedSubjects(new Set());
  };

  const handleBulkDelete = async () => {
    if (selectedSubjects.size === 0) return;
    if (!hasPermission('subjects', 'can_admin')) {
      toast({ title: 'Nedostatečná oprávnění', description: 'Nemáte oprávnění mazat subjekty.', variant: 'destructive' });
      return;
    }
    const subjectIds = Array.from(selectedSubjects);
    const { error } = await supabase.from('subjects').delete().in('id', subjectIds);
    if (error) {
      toast({ title: 'Chyba při mazání', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: `Smazáno ${subjectIds.length} subjektů` });
      fetchSubjects();
      setSelectedSubjects(new Set());
    }
  };

  const exportToXLSX = () => {
    const dataToExport = sortedSubjects.map(s => {
      let row = {};
      if (visibleColumns.name) row['Název subjektu'] = s.name;
      if (visibleColumns.ico) row['IČO'] = s.ico;
      if (visibleColumns.type) row['Typ'] = s.subject_types?.name || '-';
      if (visibleColumns.contact_person) row['Kontaktní osoba'] = s.contact_person || '-';
      if (visibleColumns.email) row['Email'] = s.email || '-';
      if (visibleColumns.phone) row['Telefon'] = s.phone || '-';
      if (visibleColumns.address) row['Adresa'] = s.address || '-';
      if (visibleColumns.region) row['Region'] = s.region || '-';
      return row;
    });

    const worksheet = XLSX.utils.json_to_sheet(dataToExport);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Subjekty");
    XLSX.writeFile(workbook, `subjekty_${new Date().toISOString().split('T')[0]}.xlsx`);
    toast({ title: '✅ Export úspěšně vygenerován!' });
  };

  const handleRefresh = () => {
    toast({ title: "Aktualizuji data..." });
    fetchSubjects();
  };

  return (
    <div className="app-page">
      <div className="space-y-6">
        <PageHeader
          icon={Building}
          title="Subjekty"
          description="Přehled a správa všech subjektů, s nimiž společnost spolupracuje."
          actions={
            <>
              {hasPermission('subjects', 'can_create') && (
                <Button onClick={() => { setEditingSubject(null); setIsDialogOpen(true); }} className="w-full md:w-auto">
                  <Plus className="w-4 h-4 mr-2" />
                  Nový subjekt
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={handleRefresh} className="bg-white/80 hidden md:inline-flex">
                <RefreshCw className="w-4 h-4 mr-2" />
                Aktualizovat
              </Button>
            </>
          }
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <Card className="xl:col-span-1">
            <CardContent className="flex items-center gap-4 p-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary ring-1 ring-primary/10">
                <Users className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-muted-foreground">Celkem</p>
                <p className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">{subjects.length}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="xl:col-span-1">
            <CardContent className="flex items-center gap-4 p-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-slate-50 text-slate-700 ring-1 ring-slate-100">
                <Phone className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-muted-foreground">S kontaktem</p>
                <p className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">{subjectsWithContact}</p>
              </div>
            </CardContent>
          </Card>
          {Object.keys(subjectTypeConfig).map((typeKey) => (
            <SubjectSummaryCard
              key={typeKey}
              typeKey={typeKey}
              count={subjectTypeCounts[typeKey] || 0}
              total={subjects.length}
            />
          ))}
        </div>

        <Card className="overflow-hidden">
          <CardContent className="p-4 sm:p-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="relative w-full xl:max-w-xl">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input placeholder="Hledat subjekt, IČO, kontaktní osobu..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-10" />
              </div>

              <div className="flex w-full flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center xl:w-auto xl:justify-end">
                <div className="flex min-w-0 items-center gap-2">
                  <Filter className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <Select value={typeFilter} onValueChange={(value) => setTypeFilter(value)}>
                    <SelectTrigger className="w-full bg-white sm:w-48">
                      <SelectValue placeholder="Filtrovat dle typu" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Všechny typy</SelectItem>
                      {Object.entries(subjectTypeConfig).map(([key, { label }]) => (
                        <SelectItem key={key} value={key}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex rounded-lg bg-slate-100 p-1">
                  <Button variant={view === 'table' ? 'secondary' : 'ghost'} onClick={() => setView('table')} size="sm" className="flex-1 sm:flex-none">
                    <List className="w-4 h-4 mr-2" /> Tabulka
                  </Button>
                  <Button variant={view === 'kanban' ? 'secondary' : 'ghost'} onClick={() => setView('kanban')} size="sm" className="flex-1 sm:flex-none">
                    <LayoutGrid className="w-4 h-4 mr-2" /> Karty
                  </Button>
                </div>
                {hasActiveFilters && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setSearchTerm('');
                      setTypeFilter('all');
                    }}
                  >
                    Zrušit filtry
                  </Button>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="icon">
                      <Settings className="w-5 h-5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel>Zobrazit sloupce</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {Object.entries(allColumns).map(([key, { label }]) => (
                      <DropdownMenuCheckboxItem key={key} checked={visibleColumns[key]} onCheckedChange={(checked) => setVisibleColumns(prev => ({ ...prev, [key]: checked }))}>
                        {label}
                      </DropdownMenuCheckboxItem>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={exportToXLSX}>
                      <Download className="w-4 h-4 mr-2" /> Export do XLSX
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Bulk Actions */}
        {selectedSubjects.size > 0 && (
          <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} className="rounded-lg border border-blue-200 bg-blue-50 p-4 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <Checkbox checked disabled />
                <span className="font-medium text-blue-800">{selectedSubjects.size} subjektů vybráno</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {hasPermission('subjects', 'can_admin') && (
                  <Button variant="destructive" size="sm" onClick={handleBulkDelete}>
                    <Trash2 className="w-4 h-4 mr-2" /> Smazat vybrané
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={() => setSelectedSubjects(new Set())}>Zrušit výběr</Button>
              </div>
            </div>
          </motion.div>
        )}

        {/* Content Area */}
        <AnimatePresence mode="wait">
          {loading ? (
            <Card>
              <CardContent className="flex h-64 items-center justify-center">
                <RefreshCw className="h-8 w-8 animate-spin text-primary" />
                <p className="ml-2 text-muted-foreground">Načítání subjektů...</p>
              </CardContent>
            </Card>
          ) : paginatedSubjects.length > 0 ? (
            view === 'table' ? (
              <motion.div key="table" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
                <SubjectTable
                  subjects={paginatedSubjects}
                  visibleColumns={visibleColumns}
                  sortConfig={sortConfig}
                  requestSort={requestSort}
                  onSelectSubject={handleSelectSubject}
                  selectedSubjects={selectedSubjects}
                  onSelectAll={handleSelectAll}
                  onEditSubject={handleEditSubject}
                  onDeleteSubject={handleDeleteSubject}
                  hasPermission={hasPermission}
                />
              </motion.div>
            ) : (
              <motion.div key="kanban" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {paginatedSubjects.map(subject => (
                  <SubjectCard key={subject.id} subject={subject} onClick={() => handleEditSubject(subject)} />
                ))}
              </motion.div>
            )
          ) : (
            <Card>
              <CardContent className="p-12 text-center">
                <Building className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">Žádné subjekty nenalezeny</h3>
                <p className="text-muted-foreground mb-4">
                  Zkuste změnit filtry nebo vytvořte nový subjekt.
                </p>
                {hasPermission('subjects', 'can_create') && (
                  <Button onClick={() => { setEditingSubject(null); setIsDialogOpen(true); }}>
                    <Plus className="w-4 h-4 mr-2" />
                    Vytvořit subjekt
                  </Button>
                )}
              </CardContent>
            </Card>
          )}
        </AnimatePresence>

        {/* Pagination */}
        {sortedSubjects.length > itemsPerPage && (
          <div className="flex flex-col gap-3 rounded-lg border bg-white p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">
                Zobrazeno {startIndex + 1}-{Math.min(endIndex, sortedSubjects.length)} z {sortedSubjects.length} subjektů
              </span>
              <Select value={itemsPerPage.toString()} onValueChange={(value) => setItemsPerPage(parseInt(value))}>
                <SelectTrigger className="w-20">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">10</SelectItem>
                  <SelectItem value="25">25</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                  <SelectItem value="100">100</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => handlePageChange(currentPage - 1)} disabled={currentPage === 1}>
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <div className="flex max-w-full items-center gap-1 overflow-x-auto">
                {Array.from({ length: totalPages }, (_, i) => i + 1).map(pageNum => (
                  <Button
                    key={pageNum}
                    variant={currentPage === pageNum ? "default" : "outline"}
                    size="sm"
                    onClick={() => handlePageChange(pageNum)}
                    className="w-8 h-8 p-0"
                  >
                    {pageNum}
                  </Button>
                ))}
              </div>
              <Button variant="outline" size="sm" onClick={() => handlePageChange(currentPage + 1)} disabled={currentPage === totalPages}>
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}

        <SubjectDialog
          isOpen={isDialogOpen}
          onClose={() => { setIsDialogOpen(false); setEditingSubject(null); }}
          onSave={handleSaveSubject}
          subject={editingSubject}
        />
      </div>
    </div>
  );
};

export default Subjects;
