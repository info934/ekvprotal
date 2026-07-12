import React, { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { ArrowLeft, Briefcase, FileText, ClipboardList, Copy, AlertTriangle, CircleDot, BadgeCheck as CircleCheck, CalendarX, Building } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { format, parseISO } from 'date-fns';

const orderStatusConfig = {
    pending: { label: 'Čeká na potvrzení', icon: CircleDot, color: 'text-orange-500' },
    confirmed: { label: 'Potvrzeno', icon: CircleCheck, color: 'text-green-500' },
    expired: { label: 'Vypršelo', icon: CalendarX, color: 'text-red-500' },
};


const SubcontractorDetail = () => {
    const { subcontractorId } = useParams();
    const { toast } = useToast();
    const { hasPermission, isAdmin } = useAuth();
    const [subcontractor, setSubcontractor] = useState(null);
    const [projects, setProjects] = useState([]);
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);

    const copyOrderLink = (token) => {
        const orderUrl = `${window.location.origin}/sub-order/${token}`;
        navigator.clipboard.writeText(orderUrl);
        toast({ title: '✅ Odkaz na objednávku zkopírován!' });
    };

    const canViewProjectFinance = isAdmin;

    const fetchData = useCallback(async () => {
        setLoading(true);

        const { data: subData, error: subError } = await supabase
            .from('subcontractors')
            .select('*')
            .eq('id', subcontractorId)
            .single();

        if (subError || !subData) {
            toast({ title: 'Chyba při načítání subdodavatele', variant: 'destructive' });
            setLoading(false);
            return;
        }
        setSubcontractor(subData);

        if (canViewProjectFinance) {
            const { data: projectData, error: projectError } = await supabase
                .from('project_subcontractors')
                .select('id, project_id, subcontractor_id, scope_of_work, status, price, projects(id, name)')
                .eq('subcontractor_id', subcontractorId);

            if (projectError) {
                toast({ title: 'Chyba při načítání projektů', variant: 'destructive' });
            } else {
                setProjects(projectData);
            }
        } else {
            setProjects([]);
        }

        const { data: ordersData, error: ordersError } = await supabase
            .from('subcontractor_orders_deprecated')
            .select('*, projects(name)')
            .eq('subcontractor_id', subcontractorId)
            .order('created_at', { ascending: false });

        if (!ordersError) {
            setOrders(ordersData);
        } else {
            toast({ title: 'Chyba při načítání objednávek', variant: 'destructive' });
        }

        setLoading(false);
    }, [canViewProjectFinance, subcontractorId, toast]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);
    
    if (loading) {
        return <div className="text-center p-8">Načítání detailu subdodavatele...</div>;
    }

    if (!subcontractor) {
        return (
            <div className="text-center p-8">
                <h2 className="text-2xl font-bold">Subdodavatel nenalezen</h2>
                <Link to="/subcontractors">
                    <Button variant="outline" className="mt-4">
                        <ArrowLeft className="w-4 h-4 mr-2" /> Zpět na seznam
                    </Button>
                </Link>
            </div>
        );
    }

    return (
        <div className="space-y-8">
             <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
                <Link to="/subcontractors">
                    <Button variant="outline" className="mb-4">
                        <ArrowLeft className="w-4 h-4 mr-2" /> Zpět na seznam subdodavatelů
                    </Button>
                </Link>
                 <div className="flex justify-between items-start">
                    <h1 className="text-4xl font-bold gradient-text mb-1 flex items-center gap-3"><Building className="w-10 h-10" />{subcontractor.company_name}</h1>
                </div>
             </motion.div>
            
            <Tabs defaultValue="overview" className="w-full">
                <TabsList>
                    <TabsTrigger value="overview">Základní info</TabsTrigger>
                    <TabsTrigger value="projects">Projekty</TabsTrigger>
                    <TabsTrigger value="orders">Objednávky</TabsTrigger>
                </TabsList>
                
                <TabsContent value="overview" className="glass-effect rounded-xl p-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        <div><p className="text-sm text-muted-foreground">IČ</p><p className="font-semibold">{subcontractor.ico || '-'}</p></div>
                        <div><p className="text-sm text-muted-foreground">DIČ</p><p className="font-semibold">{subcontractor.dic || '-'}</p></div>
                        <div><p className="text-sm text-muted-foreground">Obor</p><p className="font-semibold">{subcontractor.field_of_work || '-'}</p></div>
                        <div><p className="text-sm text-muted-foreground">Email</p><p className="font-semibold">{subcontractor.email || '-'}</p></div>
                        <div><p className="text-sm text-muted-foreground">Telefon</p><p className="font-semibold">{subcontractor.phone || '-'}</p></div>
                        <div><p className="text-sm text-muted-foreground">Hodnocení</p><p className="font-semibold">{subcontractor.rating || '-'}/5</p></div>
                    </div>
                </TabsContent>

                <TabsContent value="projects" className="glass-effect rounded-xl p-6">
                    <h3 className="text-lg font-bold flex items-center gap-2 mb-4"><FileText className="w-5 h-5 gradient-text" />Historie projektů</h3>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Název projektu</TableHead>
                                <TableHead>Stav</TableHead>
                                {canViewProjectFinance && <TableHead>Cena</TableHead>}
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {projects.length > 0 ? (
                                projects.map(p => (
                                    <TableRow key={p.id}>
                                        <TableCell className="font-medium">
                                            <Link to={`/projects/${p.projects.id}`} className="hover:text-purple-600 transition-colors">
                                                {p.projects.name}
                                            </Link>
                                        </TableCell>
                                        <TableCell>{p.status}</TableCell>
                                        {canViewProjectFinance && <TableCell className="font-semibold">{(p.price || 0).toLocaleString('cs-CZ')} Kč</TableCell>}
                                    </TableRow>
                                ))
                            ) : (
                                <TableRow>
                                    <TableCell colSpan={3} className="text-center h-24">
                                        Subdodavatel se zatím neúčastnil žádných projektů.
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </TabsContent>
                
                <TabsContent value="orders" className="glass-effect rounded-xl p-6">
                    <h3 className="text-lg font-bold flex items-center gap-2 mb-4"><ClipboardList className="w-5 h-5 gradient-text" />Historie objednávek</h3>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Projekt</TableHead>
                                <TableHead>Vytvořeno</TableHead>
                                <TableHead>Stav</TableHead>
                                <TableHead className="text-right">Odkaz</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {orders.length > 0 ? (
                                orders.map(order => {
                                    const config = orderStatusConfig[order.status] || {};
                                    const Icon = config.icon || AlertTriangle;
                                    return (
                                        <TableRow key={order.id}>
                                            <TableCell>
                                                <Link to={`/projects/${order.project_id}`} className="font-medium hover:text-purple-600">{order.projects.name}</Link>
                                            </TableCell>
                                            <TableCell>{format(parseISO(order.created_at), 'd.M.yyyy')}</TableCell>
                                            <TableCell>
                                                <div className={`inline-flex items-center gap-2 text-sm font-medium ${config.color}`}>
                                                    <Icon className="w-4 h-4" />{config.label}
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <Button variant="ghost" size="icon" onClick={() => copyOrderLink(order.unique_token)}>
                                                    <Copy className="w-4 h-4" />
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    )
                                })
                            ) : (
                                <TableRow>
                                    <TableCell colSpan={4} className="text-center h-24">
                                        Pro tohoto subdodavatele nebyly vytvořeny žádné objednávky.
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </TabsContent>

            </Tabs>
        </div>
    );
};

export default SubcontractorDetail;
