import React, { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { ArrowLeft, Briefcase, FileText, ClipboardList, Copy, AlertTriangle, Clock, CheckCircle, XCircle, Building, User, Mail, Phone, MapPin, ExternalLink, Edit2, Plus, DollarSign, Tag, ChevronDown, ChevronUp, Filter } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const orderStatusConfig = {
    pending: { label: 'Čeká na potvrzení', icon: Clock, color: 'text-yellow-500' },
    confirmed: { label: 'Potvrzeno', icon: CheckCircle, color: 'text-green-500' },
    rejected: { label: 'Odmítnuto', icon: XCircle, color: 'text-red-500' },
    expired: { label: 'Vypršelo', icon: XCircle, color: 'text-gray-500' },
};

const StatCard = ({ title, value, icon: Icon, color = "default" }) => {
    const colorClasses = {
        default: "bg-white border-slate-200 text-slate-900",
        success: "bg-green-50 border-green-200 text-green-900",
        warning: "bg-yellow-50 border-yellow-200 text-yellow-900",
        danger: "bg-red-50 border-red-200 text-red-900",
        info: "bg-blue-50 border-blue-200 text-blue-900"
    };

    return (
        <motion.div 
            className={`rounded-xl border p-4 hover:shadow-md transition-all duration-300 ${colorClasses[color]}`}
            whileHover={{ scale: 1.02 }}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
        >
            <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                    color === 'success' ? 'bg-green-500' :
                    color === 'warning' ? 'bg-yellow-500' :
                    color === 'danger' ? 'bg-red-500' :
                    color === 'info' ? 'bg-blue-500' :
                    'bg-slate-500'
                }`}>
                    <Icon className="w-5 h-5 text-white" />
                </div>
                <div className="flex-1">
                    <p className="text-sm font-medium opacity-80">{title}</p>
                    <p className="text-lg font-bold">{value}</p>
                </div>
            </div>
        </motion.div>
    );
};

const CollapsibleSection = ({ title, icon: Icon, children, defaultOpen = true, className = "", actions }) => {
    const [isOpen, setIsOpen] = useState(defaultOpen);
    
    return (
        <div className={cn("transition-all duration-200 bg-white rounded-lg border", className)}>
            <div 
                className="cursor-pointer hover:bg-gray-50 transition-colors p-4 border-b"
                onClick={() => setIsOpen(!isOpen)}
            >
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        {Icon && <Icon className="h-5 w-5 text-primary" />}
                        <h3 className="text-lg font-semibold">{title}</h3>
                    </div>
                    <div className="flex items-center gap-2">
                        {actions && <div onClick={(e) => e.stopPropagation()}>{actions}</div>}
                        {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </div>
                </div>
            </div>
            {isOpen && (
                <div className="p-4">
                    {children}
                </div>
            )}
        </div>
    );
};

const SubjectDetail = () => {
    const { subjectId } = useParams();
    const { toast } = useToast();
    const { hasPermission } = useAuth();
    
    const [subject, setSubject] = useState(null);
    const [projectsAsSubcontractor, setProjectsAsSubcontractor] = useState([]);
    const [projectsAsInvestor, setProjectsAsInvestor] = useState([]);
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [projectFilter, setProjectFilter] = useState('all'); // 'all', 'active', 'closed'

    const copyOrderLink = (token) => {
        const orderUrl = `${window.location.origin}/sub-order/${token}`;
        navigator.clipboard.writeText(orderUrl);
        toast({ title: '✅ Odkaz na objednávku zkopírován!' });
    };

    const fetchData = useCallback(async () => {
        setLoading(true);

        const { data: subData, error: subError } = await supabase
            .from('subjects')
            .select('*, subject_types(name)')
            .eq('id', subjectId)
            .single();

        if (subError || !subData) {
            toast({ title: 'Chyba při načítání subjektu', variant: 'destructive', description: subError?.message });
            setLoading(false);
            return;
        }
        setSubject(subData);

        // 1. Projects where subject is subcontractor
        const { data: subProjectsData, error: subProjectsError } = await supabase
            .from('project_subcontractors')
            .select('*, projects(*)')
            .eq('subject_id', subjectId);

        if (subProjectsError) {
            toast({ title: 'Chyba při načítání subdodavatelských projektů', variant: 'destructive', description: subProjectsError.message });
        } else {
            setProjectsAsSubcontractor(subProjectsData || []);
        }

        // 2. Projects where subject is investor or client
        // Check permissions first - sensitive data
        if (hasPermission('projects', 'can_read')) {
            const { data: invProjectsData, error: invProjectsError } = await supabase
                .from('projects')
                .select('*')
                .or(`investor_id.eq.${subjectId},client_id.eq.${subjectId}`)
                .order('created_at', { ascending: false });

            if (invProjectsError) {
                 toast({ title: 'Chyba při načítání investorských projektů', variant: 'destructive', description: invProjectsError.message });
            } else {
                setProjectsAsInvestor(invProjectsData || []);
            }
        }

        // 3. Orders
        const { data: ordersData, error: ordersError } = await supabase
            .from('subcontractor_orders')
            .select('*, projects(name)')
            .eq('subject_id', subjectId)
            .order('created_at', { ascending: false });

        if (!ordersError) {
            setOrders(ordersData || []);
        } else {
            toast({ title: 'Chyba při načítání objednávek', variant: 'destructive', description: ordersError.message });
        }

        setLoading(false);
    }, [subjectId, toast, hasPermission]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const getFilteredProjects = () => {
        let filtered = projectsAsInvestor;
        if (projectFilter === 'active') {
            filtered = filtered.filter(p => !['closed', 'delivered'].includes(p.status));
        } else if (projectFilter === 'closed') {
             filtered = filtered.filter(p => ['closed', 'delivered'].includes(p.status));
        }
        return filtered;
    };

    const filteredInvestorProjects = getFilteredProjects();
    const totalInvestorValue = filteredInvestorProjects.reduce((sum, p) => sum + (p.price || 0), 0);
    const totalSubcontractorValue = projectsAsSubcontractor.reduce((sum, p) => sum + (p.price || 0), 0);

    if (loading) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-slate-50 to-purple-50 flex items-center justify-center">
                <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="text-center"
                >
                    <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                    <p className="text-xl font-medium text-slate-700">Načítání subjektu...</p>
                </motion.div>
            </div>
        );
    }

    if (!subject) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-slate-50 to-purple-50 flex items-center justify-center p-4">
                <motion.div 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-center p-10 bg-white/90 backdrop-blur-xl rounded-3xl shadow-2xl max-w-md"
                >
                    <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
                        <AlertTriangle className="w-10 h-10 text-red-500" />
                    </div>
                    <h1 className="text-3xl font-bold mb-4 text-slate-900">Subjekt nenalezen</h1>
                    <p className="text-lg text-slate-600 mb-8">Požadovaný subjekt nebyl nalezen nebo byl smazán.</p>
                    <Link to="/subjects">
                        <Button 
                            className="bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white px-8 py-3 rounded-xl font-semibold shadow-lg hover:shadow-xl transition-all duration-300" 
                        >
                            <ArrowLeft className="w-5 h-5 mr-2" />
                            Zpět na seznam subjektů
                        </Button>
                    </Link>
                </motion.div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-purple-50">
            {/* Header */}
            <div className="bg-white/80 backdrop-blur-xl border-b border-white/20 sticky top-0 z-10">
                <div className="max-w-6xl mx-auto px-6 py-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <Link to="/subjects" className="flex items-center gap-2 text-slate-600 hover:text-primary transition-colors">
                                <ArrowLeft className="w-5 h-5" />
                                <span className="text-sm font-medium">Zpět na subjekty</span>
                            </Link>
                        </div>
                        <div className="flex gap-2">
                             {/* Future Edit Logic Here */}
                        </div>
                    </div>
                </div>
            </div>

            {/* Main Content */}
            <div className="max-w-6xl mx-auto px-6 py-8">
                <motion.div 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5 }}
                    className="space-y-6"
                >
                    {/* Subject Header */}
                    <div className="bg-white/80 backdrop-blur-xl rounded-2xl border border-white/20 p-6">
                        <div className="flex items-center gap-4">
                            <div className="w-16 h-16 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-2xl flex items-center justify-center">
                                <Building className="w-8 h-8 text-white" />
                            </div>
                            <div className="flex-1">
                                <h1 className="text-3xl font-bold text-slate-900 mb-2">{subject.name}</h1>
                                <div className="flex items-center gap-4 text-slate-600">
                                    {subject.subject_types?.name && (
                                        <div className="flex items-center gap-2">
                                            <Tag className="w-4 h-4" />
                                            <span className="text-sm font-medium">{subject.subject_types.name}</span>
                                        </div>
                                    )}
                                    {subject.ico && (
                                        <div className="flex items-center gap-2">
                                            <FileText className="w-4 h-4" />
                                            <span className="text-sm">IČO: {subject.ico}</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Stats Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                        <StatCard 
                            title="Projekty (Investor)" 
                            value={projectsAsInvestor.length} 
                            icon={Briefcase} 
                            color="info"
                        />
                         <StatCard 
                            title="Projekty (Subdodavatel)" 
                            value={projectsAsSubcontractor.length} 
                            icon={FileText} 
                            color="warning"
                        />
                        <StatCard 
                            title="Objednávky" 
                            value={orders.length} 
                            icon={ClipboardList} 
                            color="success"
                        />
                        <StatCard 
                            title="Investice celkem" 
                            value={`${totalInvestorValue.toLocaleString('cs-CZ')} Kč`} 
                            icon={DollarSign} 
                            color="default"
                        />
                    </div>

                    {/* Main Content Tabs */}
                    <Tabs defaultValue="overview" className="w-full">
                        <TabsList className="grid w-full grid-cols-4">
                            <TabsTrigger value="overview">Přehled</TabsTrigger>
                            <TabsTrigger value="investor_projects">Projekty (Investor)</TabsTrigger>
                            <TabsTrigger value="sub_projects">Projekty (Subdodavatel)</TabsTrigger>
                            <TabsTrigger value="orders">Objednávky</TabsTrigger>
                        </TabsList>
                        
                        <TabsContent value="overview" className="mt-6 space-y-4">
                            {/* Contact Information */}
                            <CollapsibleSection title="Kontaktní informace" icon={Briefcase}>
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                    {subject.ico && (
                                        <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                                            <FileText className="w-5 h-5 text-slate-500" />
                                            <div>
                                                <p className="text-sm text-slate-600">IČO</p>
                                                <p className="font-semibold">{subject.ico}</p>
                                            </div>
                                        </div>
                                    )}
                                    {subject.dic && (
                                        <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                                            <FileText className="w-5 h-5 text-slate-500" />
                                            <div>
                                                <p className="text-sm text-slate-600">DIČ</p>
                                                <p className="font-semibold">{subject.dic}</p>
                                            </div>
                                        </div>
                                    )}
                                    {subject.region && (
                                        <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                                            <MapPin className="w-5 h-5 text-slate-500" />
                                            <div>
                                                <p className="text-sm text-slate-600">Kraj</p>
                                                <p className="font-semibold">{subject.region}</p>
                                            </div>
                                        </div>
                                    )}
                                    {subject.address && (
                                        <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                                            <MapPin className="w-5 h-5 text-slate-500" />
                                            <div>
                                                <p className="text-sm text-slate-600">Adresa</p>
                                                <p className="font-semibold">{subject.address}</p>
                                            </div>
                                        </div>
                                    )}
                                    {subject.contact_person && (
                                        <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                                            <User className="w-5 h-5 text-slate-500" />
                                            <div>
                                                <p className="text-sm text-slate-600">Kontaktní osoba</p>
                                                <p className="font-semibold">{subject.contact_person}</p>
                                            </div>
                                        </div>
                                    )}
                                    {subject.email && (
                                        <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                                            <Mail className="w-5 h-5 text-slate-500" />
                                            <div>
                                                <p className="text-sm text-slate-600">Email</p>
                                                <p className="font-semibold">{subject.email}</p>
                                            </div>
                                        </div>
                                    )}
                                    {subject.phone && (
                                        <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                                            <Phone className="w-5 h-5 text-slate-500" />
                                            <div>
                                                <p className="text-sm text-slate-600">Telefon</p>
                                                <p className="font-semibold">{subject.phone}</p>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </CollapsibleSection>
                        </TabsContent>

                        {/* Projects as Investor / Client */}
                        <TabsContent value="investor_projects" className="mt-6 space-y-4">
                             <div className="flex justify-between items-center mb-4">
                                <h3 className="text-lg font-semibold">Projekty (Investor/Klient)</h3>
                                <div className="flex items-center gap-2">
                                    <Filter className="w-4 h-4 text-muted-foreground" />
                                    <Select value={projectFilter} onValueChange={setProjectFilter}>
                                        <SelectTrigger className="w-[180px]">
                                            <SelectValue placeholder="Filtrovat projekty" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="all">Všechny projekty</SelectItem>
                                            <SelectItem value="active">Aktivní</SelectItem>
                                            <SelectItem value="closed">Uzavřené / Dodané</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>

                            <CollapsibleSection title={`Seznam projektů (${filteredInvestorProjects.length})`} icon={Briefcase}>
                                {filteredInvestorProjects.length > 0 ? (
                                    <div className="space-y-3">
                                        {filteredInvestorProjects.map(project => (
                                            <div key={project.id} className="bg-white rounded-lg border p-4 hover:shadow-md transition-shadow group">
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-4">
                                                        <div className="w-12 h-12 bg-blue-50 rounded-lg flex items-center justify-center border border-blue-100">
                                                            <Briefcase className="h-6 w-6 text-blue-600" />
                                                        </div>
                                                        <div>
                                                            <Link 
                                                                to={`/projects/${project.id}`} 
                                                                className="text-lg font-semibold hover:text-primary transition-colors flex items-center gap-2"
                                                            >
                                                                {project.name}
                                                                <span className="text-xs font-normal text-muted-foreground bg-slate-100 px-2 py-0.5 rounded-full border border-slate-200">
                                                                    {project.code}
                                                                </span>
                                                            </Link>
                                                            <div className="flex items-center gap-4 mt-1">
                                                                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                                                                    ['delivered', 'closed'].includes(project.status) 
                                                                        ? 'bg-slate-100 text-slate-700 border border-slate-200' 
                                                                        : 'bg-green-100 text-green-700 border border-green-200'
                                                                }`}>
                                                                    {project.status === 'delivered' ? 'Dodáno' : 
                                                                     project.status === 'closed' ? 'Uzavřeno' : 
                                                                     project.status === 'active' ? 'Aktivní' : project.status}
                                                                </span>
                                                                {project.completion_date && (
                                                                    <span className="text-sm text-slate-500 flex items-center gap-1">
                                                                        <Clock className="w-3 h-3" />
                                                                        {format(parseISO(project.completion_date), 'd.M.yyyy')}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="text-right">
                                                        <p className="text-lg font-bold text-slate-900">
                                                            {(project.price || 0).toLocaleString('cs-CZ')} Kč
                                                        </p>
                                                        <p className="text-xs text-slate-500">Cena projektu</p>
                                                    </div>
                                                </div>
                                                {project.description && (
                                                    <div className="mt-3 pt-3 border-t border-slate-100 text-sm text-slate-600">
                                                        {project.description}
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                        <div className="mt-4 p-4 bg-slate-50 rounded-lg border border-slate-200 flex justify-between items-center">
                                            <span className="font-semibold text-slate-700">Celková hodnota zobrazených projektů:</span>
                                            <span className="text-xl font-bold text-primary">{totalInvestorValue.toLocaleString('cs-CZ')} Kč</span>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="text-center py-12">
                                        <Briefcase className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                                        <p className="text-slate-500 font-medium">Žádné projekty odpovídající filtru.</p>
                                        {projectFilter !== 'all' && (
                                            <Button variant="link" onClick={() => setProjectFilter('all')}>Zobrazit všechny</Button>
                                        )}
                                    </div>
                                )}
                            </CollapsibleSection>
                        </TabsContent>

                        {/* Projects as Subcontractor */}
                        <TabsContent value="sub_projects" className="mt-6 space-y-4">
                            <CollapsibleSection 
                                title="Historie projektů (Jako subdodavatel)" 
                                icon={FileText}
                                actions={
                                    projectsAsSubcontractor.length > 0 && (
                                        <Button variant="outline" size="sm" className="flex items-center gap-2">
                                            <Plus className="w-4 h-4" />
                                            Nový projekt
                                        </Button>
                                    )
                                }
                            >
                                {projectsAsSubcontractor.length > 0 ? (
                                    <div className="space-y-3">
                                        {projectsAsSubcontractor.map(project => (
                                            <div key={project.id} className="bg-white rounded-lg border p-4 hover:shadow-md transition-shadow">
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center">
                                                            <FileText className="h-5 w-5 text-orange-600" />
                                                        </div>
                                                        <div>
                                                            <Link 
                                                                to={`/projects/${project.projects?.id}`} 
                                                                className="font-semibold hover:text-primary transition-colors"
                                                            >
                                                                {project.projects?.name || 'Neznámý projekt'}
                                                            </Link>
                                                            <p className="text-sm text-slate-600">{project.scope_of_work || 'Bez popisu práce'}</p>
                                                        </div>
                                                    </div>
                                                    <div className="text-right">
                                                        <p className="font-semibold text-green-600">
                                                            {(project.price || 0).toLocaleString('cs-CZ')} Kč
                                                        </p>
                                                        <p className="text-xs text-slate-400">Smluvená cena</p>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                         <div className="mt-4 p-4 bg-slate-50 rounded-lg border border-slate-200 flex justify-between items-center">
                                            <span className="font-semibold text-slate-700">Celková hodnota subdodávek:</span>
                                            <span className="text-xl font-bold text-primary">{totalSubcontractorValue.toLocaleString('cs-CZ')} Kč</span>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="text-center py-8">
                                        <FileText className="w-12 h-12 text-slate-400 mx-auto mb-4" />
                                        <p className="text-slate-600">Subjekt se zatím neúčastnil žádných projektů jako subdodavatel.</p>
                                    </div>
                                )}
                            </CollapsibleSection>
                        </TabsContent>
                        
                        <TabsContent value="orders" className="mt-6 space-y-4">
                            <CollapsibleSection 
                                title="Historie objednávek" 
                                icon={ClipboardList}
                                actions={
                                    orders.length > 0 && (
                                        <Button variant="outline" size="sm" className="flex items-center gap-2">
                                            <Plus className="w-4 h-4" />
                                            Nová objednávka
                                        </Button>
                                    )
                                }
                            >
                                {orders.length > 0 ? (
                                    <div className="space-y-3">
                                        {orders.map(order => {
                                            const config = orderStatusConfig[order.status] || {label: order.status, icon: AlertTriangle, color: 'text-slate-500' };
                                            const Icon = config.icon;
                                            return (
                                                <div key={order.id} className="bg-white rounded-lg border p-4 hover:shadow-md transition-shadow">
                                                    <div className="flex items-center justify-between">
                                                        <div className="flex items-center gap-3">
                                                            <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                                                                <ClipboardList className="h-5 w-5 text-purple-600" />
                                                            </div>
                                                            <div>
                                                                <Link 
                                                                    to={`/projects/${order.project_id}`} 
                                                                    className="font-semibold hover:text-primary transition-colors"
                                                                >
                                                                    {order.projects?.name || 'Neznámý projekt'}
                                                                </Link>
                                                                <p className="text-sm text-slate-600">
                                                                    {format(parseISO(order.created_at), 'd.M.yyyy')}
                                                                </p>
                                                            </div>
                                                        </div>
                                                        <div className="flex items-center gap-3">
                                                            <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm font-medium ${
                                                                order.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                                                                order.status === 'confirmed' ? 'bg-green-100 text-green-800' :
                                                                order.status === 'rejected' ? 'bg-red-100 text-red-800' :
                                                                'bg-gray-100 text-gray-800'
                                                            }`}>
                                                                <Icon className="w-4 h-4" />
                                                                {config.label}
                                                            </div>
                                                            <div className="flex gap-1">
                                                                <Button 
                                                                    variant="ghost" 
                                                                    size="sm"
                                                                    onClick={() => copyOrderLink(order.unique_token)}
                                                                    title="Kopírovat odkaz"
                                                                >
                                                                    <Copy className="w-4 h-4" />
                                                                </Button>
                                                                <Button 
                                                                    variant="ghost" 
                                                                    size="sm"
                                                                    onClick={() => window.open(`/sub-order/${order.unique_token}`, '_blank')}
                                                                    title="Otevřít objednávku"
                                                                >
                                                                    <ExternalLink className="w-4 h-4" />
                                                                </Button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <div className="text-center py-8">
                                        <ClipboardList className="w-12 h-12 text-slate-400 mx-auto mb-4" />
                                        <p className="text-slate-600">Pro tento subjekt nebyly vytvořeny žádné objednávky.</p>
                                        <Button variant="outline" className="mt-4">
                                            <Plus className="w-4 h-4 mr-2" />
                                            Vytvořit první objednávku
                                        </Button>
                                    </div>
                                )}
                            </CollapsibleSection>
                        </TabsContent>
                    </Tabs>
                </motion.div>
            </div>
        </div>
    );
};

export default SubjectDetail;