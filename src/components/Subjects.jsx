import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Link, useNavigate } from 'react-router-dom';
import {
  Plus, Building, Search, Filter, List, LayoutGrid, AlertTriangle, RefreshCw,
  MoreHorizontal, Edit, Trash2, ChevronLeft, ChevronRight, Factory, Home, User2,
  Phone, Settings, Download
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import SubjectDialog from '@/components/SubjectDialog';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from '@/lib/utils';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuCheckboxItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import * as XLSX from 'xlsx';
import PageHeader from '@/components/ui/page-header';

// UI components (Card, CardContent, CardHeader, CardTitle, Badge)
// These are simplified versions to avoid importing entire shadcn/ui components if not necessary for specific styling.
const Card = ({ children, className, ...props }) => (
  <div
    className={cn("rounded-xl border bg-card text-card-foreground shadow-sm hover:shadow-md transition-shadow", className)}
    {...props}
  >
    {children}
  </div>
);

const CardContent = ({ children, className, ...props }) => (
  <div className={cn("p-6", className)} {...props}>
    {children}
  </div>
);

const CardHeader = ({ children, className, ...props }) => (
  <div className={cn("flex flex-col space-y-1.5 p-6", className)} {...props}>
    {children}
  </div>
);

const CardTitle = ({ children, className, ...props }) => (
  <h3 className={cn("font-semibold leading-none tracking-tight", className)} {...props}>
    {children}
  </h3>
);

const Badge = ({ children, variant = "default", className, ...props }) => {
  const variants = {
    default: "bg-primary text-primary-foreground hover:bg-primary/80",
    secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
    destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/80",
    outline: "text-foreground border border-input bg-background hover:bg-accent hover:text-accent-foreground",
    customer: "bg-green-100 text-green-800 border-green-200",
    supplier: "bg-blue-100 text-blue-800 border-blue-200",
    investor: "bg-purple-100 text-purple-800 border-purple-200",
    authority: "bg-orange-100 text-orange-800 border-orange-200",
    other: "bg-gray-100 text-gray-800 border-gray-200"
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 border",
        variants[variant],
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
};

const subjectTypeConfig = {
  customer: { label: 'Zákazník', icon: User2, color: 'text-green-600', variant: 'customer' },
  supplier: { label: 'Dodavatel', icon: Factory, color: 'text-blue-600', variant: 'supplier' },
  investor: { label: 'Investor', icon: Home, color: 'text-purple-600', variant: 'investor' },
  authority: { label: 'Úřad', icon: Building, color: 'text-orange-600', variant: 'authority' },
  other: { label: 'Ostatní', icon: User2, color: 'text-gray-600', variant: 'other' },
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
      className="group bg-white border rounded-xl p-4 mb-4 cursor-pointer hover:shadow-lg hover:border-primary/50 transition-all duration-200"
    >
      <div className="flex justify-between items-start mb-3">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Icon className={cn("w-4 h-4 flex-shrink-0", config.color)} />
          <h3 className="font-semibold text-sm truncate">{subject.name}</h3>
        </div>
        <Badge variant={config.variant} className="text-xs flex-shrink-0">
          {config.label}
        </Badge>
      </div>
      <p className="text-sm text-muted-foreground mt-1">{subject.ico}</p>
      <div className="space-y-2 text-sm mt-3">
        {subject.contact_person && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <User2 className="w-3 h-3 flex-shrink-0" />
            <span className="truncate">{subject.contact_person}</span>
          </div>
        )}
        {subject.phone && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Phone className="w-3 h-3 flex-shrink-0" />
            <span className="truncate">{subject.phone}</span>
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
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
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
                    <TableHead key={key} onClick={() => requestSort(key)} className="cursor-pointer hover:bg-slate-100">
                      {label}
                      {sortConfig.key === key ? (sortConfig.direction === 'ascending' ? ' ▲' : ' ▼') : ''}
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
                      "cursor-pointer hover:bg-slate-50",
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
                      <TableCell>
                        <div className="font-semibold text-sm flex items-center gap-1">
                          <Icon className={cn("w-3 h-3", config.color)} />
                          {subject.name}
                        </div>
                      </TableCell>
                    )}
                    {visibleColumns.ico && <TableCell className="text-sm">{subject.ico}</TableCell>}
                    {visibleColumns.type && (
                      <TableCell>
                        <Badge variant={config.variant}>{config.label}</Badge>
                      </TableCell>
                    )}
                    {visibleColumns.contact_person && <TableCell className="text-sm">{subject.contact_person || '-'}</TableCell>}
                    {visibleColumns.email && <TableCell className="text-sm">{subject.email || '-'}</TableCell>}
                    {visibleColumns.phone && <TableCell className="text-sm">{subject.phone || '-'}</TableCell>}
                    {visibleColumns.address && <TableCell className="text-sm">{subject.address || '-'}</TableCell>}
                    {visibleColumns.region && <TableCell className="text-sm">{subject.region || '-'}</TableCell>}
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
        </div>
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
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
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
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="hidden"
        >
          <div>
            <h1 className="text-3xl font-bold text-slate-800 mb-2 flex items-center gap-3">
              <Building className="w-8 h-8 text-primary" />
              Subjekty
            </h1>
            <p className="text-muted-foreground">
              Přehled a správa všech subjektů, s nimiž společnost spolupracuje.
            </p>
          </div>
          <div className="flex items-center gap-3 w-full md:w-auto">
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
          </div>
        </motion.div>

        {/* Filters and Controls */}
        <Card>
          <CardContent className="p-6">
            <div className="flex flex-col lg:flex-row gap-4 items-start lg:items-center justify-between">
              {/* Search */}
              <div className="relative flex-1 w-full max-w-md">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
                <Input placeholder="Hledat subjekt, IČO, kontaktní osobu..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-10" />
              </div>

              {/* Filters */}
              <div className="flex flex-wrap gap-2 items-center">
                <div className="flex items-center gap-2">
                  <Filter className="w-4 h-4 text-muted-foreground" />
                  <Select value={typeFilter} onValueChange={(value) => setTypeFilter(value)}>
                    <SelectTrigger className="w-48">
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

                <div className="flex gap-2">
                  <Button variant={view === 'table' ? 'default' : 'outline'} onClick={() => setView('table')} size="sm">
                    <List className="w-4 h-4 mr-2" /> Tabulka
                  </Button>
                  <Button variant={view === 'kanban' ? 'default' : 'outline'} onClick={() => setView('kanban')} size="sm">
                    <LayoutGrid className="w-4 h-4 mr-2" /> Karty
                  </Button>
                </div>
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
          <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Checkbox checked disabled />
                <span className="font-medium text-blue-800">{selectedSubjects.size} subjektů vybráno</span>
              </div>
              <div className="flex gap-2">
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
            <div className="flex justify-center items-center h-64">
              <RefreshCw className="w-8 h-8 animate-spin text-primary" />
              <p className="ml-2 text-muted-foreground">Načítání subjektů...</p>
            </div>
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
              <motion.div key="kanban" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
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
          <div className="flex items-center justify-between mt-4">
            <div className="flex items-center gap-2">
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
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => handlePageChange(currentPage - 1)} disabled={currentPage === 1}>
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <div className="flex items-center gap-1">
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
