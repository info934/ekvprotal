import React, { useState, useEffect } from 'react';
    import { useParams, useNavigate } from 'react-router-dom';
    import { supabase } from '@/lib/customSupabaseClient';
    import { Button } from '@/components/ui/button';
    import { useToast } from '@/components/ui/use-toast';
    import { motion } from 'framer-motion';
    import { CheckCircle, Clock, FileText, User, DollarSign, AlertTriangle, CalendarX, Briefcase, Printer, Copy, Building2, MapPin, Hash, CreditCard } from 'lucide-react';
    import { format, parseISO } from 'date-fns';

    const InfoCard = ({ icon: Icon, label, value, className = "" }) => (
        <div className={`bg-white border border-gray-200 rounded-lg p-4 ${className}`}>
            <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                    <Icon className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                    <p className="text-sm text-gray-600 font-medium">{label}</p>
                    <p className="text-lg font-semibold text-gray-900">{value}</p>
                </div>
            </div>
        </div>
    );

    const CompanyHeader = () => (
        <div className="bg-white border-b-2 border-gray-200 p-6 mb-8">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <div className="relative">
                        <img 
                            src="https://horizons-cdn.hostinger.com/71f822ff-0858-4714-9f59-dcfbecb55c00/2f93fb620df7a7540852c9ec9f499aee.png" 
                            alt="EKV Project Logo" 
                            className="h-16 w-auto" 
                        />
                        <div className="absolute -top-1 -right-1 w-3 h-3 bg-green-500 border-2 border-white rounded-full"></div>
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">EKV Project s.r.o.</h1>
                        <p className="text-gray-600">Stavební a projektová společnost</p>
                    </div>
                </div>
                <div className="text-right text-sm text-gray-600">
                    <div className="flex items-center gap-2 mb-1">
                        <MapPin className="w-4 h-4" />
                        <span>Papírnická 2809/16, Východní Předměstí</span>
                    </div>
                    <div className="flex items-center gap-2 mb-1">
                        <span>326 00 Plzeň</span>
                    </div>
                    <div className="flex items-center gap-2 mb-1">
                        <Hash className="w-4 h-4" />
                        <span>IČO: 10793615</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <CreditCard className="w-4 h-4" />
                        <span>DIČ: CZ10793615</span>
                    </div>
                </div>
            </div>
        </div>
    );

    const SubcontractorOrderPage = () => {
        const { token } = useParams();
        const navigate = useNavigate();
        const { toast } = useToast();
        const [order, setOrder] = useState(null);
        const [loading, setLoading] = useState(true);
        const [error, setError] = useState(null);
        const [isConfirming, setIsConfirming] = useState(false);

        useEffect(() => {
            const fetchOrder = async () => {
                const { data, error: fetchError } = await supabase
                    .rpc('get_public_subcontractor_order', { p_token: token });

                if (fetchError || !data) {
                    setError('Objednávka nebyla nalezena nebo je neplatná.');
                    setLoading(false);
                    return;
                }
                
                setOrder(data);
                setLoading(false);
            };

            if (token) {
                 fetchOrder();
            }
        }, [token]);

        const copyOrderLink = () => {
        navigator.clipboard.writeText(window.location.href);
        toast({ title: '✅ Odkaz na objednávku zkopírován!' });
    };

        const printOrder = () => {
        window.print();
    };

        const handleConfirm = async () => {
            setIsConfirming(true);
            const { data: responseData, error: updateError } = await supabase.rpc('respond_public_subcontractor_order', {
                p_token: token,
                p_response: 'confirmed',
            });

            if (updateError) {
                toast({ title: 'Chyba při potvrzování', description: updateError.message, variant: 'destructive' });
            } else {
                toast({ title: '✅ Objednávka úspěšně potvrzena!', description: 'Děkujeme za spolupráci.' });
                setOrder(prev => ({ ...prev, status: responseData?.status || 'confirmed' }));
            }
            setIsConfirming(false);
        };

        if (loading) {
            return (
                <div className="flex h-screen items-center justify-center bg-slate-50">
                    <p className="text-xl">Načítání objednávky...</p>
                </div>
            );
        }
        
        if (error) {
             return (
                <div className="flex h-screen items-center justify-center bg-slate-50">
                     <motion.div 
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="text-center p-10 bg-white rounded-2xl shadow-xl max-w-md"
                    >
                        <AlertTriangle className="w-16 h-16 text-red-500 mx-auto mb-4" />
                        <h1 className="text-3xl font-bold mb-2">Chyba</h1>
                        <p className="text-lg text-muted-foreground">{error}</p>
                         <Button className="mt-6" onClick={() => navigate('/')}>Zpět na hlavní stránku</Button>
                    </motion.div>
                </div>
            );
        }

        const isExpired = order.status === 'expired';
        const isConfirmed = order.status === 'confirmed';
        const projectSubcontractorDetails = order.project_subcontractor_details;


        return (
            <div className="min-h-screen bg-gray-50">
                {/* Print Header - only visible when printing */}
                <div className="hidden print:block bg-white border-b-2 border-gray-300 p-6 mb-8">
                    <CompanyHeader />
                </div>

                {/* Main Content */}
                <div className="max-w-4xl mx-auto bg-white shadow-lg print:shadow-none">
                    {/* Company Header - hidden when printing */}
                    <div className="print:hidden">
                        <CompanyHeader />
                    </div>

                    <div className="p-8 print:p-6">
                        {/* Document Title */}
                        <div className="text-center mb-8 print:mb-6">
                            <h1 className="text-3xl font-bold text-gray-900 print:text-2xl">OBJEDNÁVKA PRACÍ</h1>
                            <p className="text-gray-600 mt-2 print:text-sm">Detail zakázky a potvrzení vaší účasti</p>
                        </div>
                        
                        {/* Order Information Grid */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8 print:mb-6">
                            <InfoCard icon={FileText} label="Název projektu" value={order.projects.name} />
                            <InfoCard icon={User} label="Subdodavatel" value={order.subjects.name} />
                            <InfoCard icon={DollarSign} label="Cena za práce" value={`${(projectSubcontractorDetails?.price || 0).toLocaleString('cs-CZ')} Kč`} />
                            <InfoCard icon={CalendarX} label="Vyprší" value={format(parseISO(order.expires_at), 'd. M. yyyy')} />
                        </div>

                        {/* Scope of Work */}
                        <div className="bg-gray-50 border border-gray-200 rounded-lg p-6 mb-8 print:mb-6">
                            <h3 className="font-bold text-lg mb-4 flex items-center gap-2 text-gray-900">
                                <Briefcase className="w-5 h-5 text-blue-600"/>
                                Rozsah práce
                            </h3>
                            <div className="prose prose-sm max-w-none text-gray-700">
                                <p className="whitespace-pre-wrap">{projectSubcontractorDetails?.scope_of_work || 'Rozsah práce nebyl specifikován.'}</p>
                            </div>
                        </div>
                        
                        {/* Status Messages */}
                        {isConfirmed && (
                            <div className="bg-green-50 border border-green-200 rounded-lg p-6 mb-8 print:mb-6">
                                <div className="flex items-center gap-3">
                                    <CheckCircle className="w-8 h-8 text-green-600"/>
                                    <div>
                                        <p className="font-bold text-green-800 text-lg">Objednávka je již potvrzena</p>
                                        <p className="text-green-700">Děkujeme, těšíme se na spolupráci!</p>
                                    </div>
                                </div>
                            </div>
                        )}
                        
                        {isExpired && (
                            <div className="bg-red-50 border border-red-200 rounded-lg p-6 mb-8 print:mb-6">
                                <div className="flex items-center gap-3">
                                    <CalendarX className="w-8 h-8 text-red-600"/>
                                    <div>
                                        <p className="font-bold text-red-800 text-lg">Platnost objednávky vypršela</p>
                                        <p className="text-red-700">Platnost vypršela dne {format(parseISO(order.expires_at), 'd. M. yyyy')}. Pro více informací nás kontaktujte.</p>
                                    </div>
                                </div>
                            </div>
                        )}

                        {!isConfirmed && !isExpired && (
                            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 mb-8 print:mb-6">
                                <div className="flex items-center gap-3">
                                    <Clock className="w-8 h-8 text-yellow-600"/>
                                    <div>
                                        <p className="font-bold text-yellow-800 text-lg">Potvrďte prosím přijetí zakázky</p>
                                        <p className="text-yellow-700">Tato objednávka je platná do {format(parseISO(order.expires_at), 'd. M. yyyy')}.</p>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Action Buttons */}
                        <div className="flex flex-col sm:flex-row gap-4 justify-center print:hidden">
                            <Button 
                                variant="outline" 
                                onClick={copyOrderLink}
                                className="flex items-center gap-2"
                            >
                                <Copy className="w-4 h-4" />
                                Kopírovat odkaz
                            </Button>
                            <Button 
                                variant="outline" 
                                onClick={printOrder}
                                className="flex items-center gap-2"
                            >
                                <Printer className="w-4 h-4" />
                                Tisknout
                            </Button>
                            <Button 
                                size="lg" 
                                className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-8 py-3"
                                onClick={handleConfirm}
                                disabled={isConfirming || isConfirmed || isExpired}
                            >
                                {isConfirming ? 'Potvrzuji...' : 'Potvrdit a přijmout zakázku'}
                            </Button>
                        </div>

                        {/* Print Footer */}
                        <div className="hidden print:block mt-12 pt-6 border-t border-gray-300">
                            <div className="text-center text-sm text-gray-600">
                                <p>Dokument vytvořen: {format(new Date(), 'd. M. yyyy HH:mm')}</p>
                                <p>EKV Project s.r.o. | Papírnická 2809/16, 326 00 Plzeň | IČO: 10793615</p>
                            </div>
                        </div>

                        {/* Billing Information */}
                        <div className="bg-gray-50 border border-gray-200 rounded-lg p-6 mb-8 print:mb-6 billing-info">
                            <h3 className="font-bold text-lg mb-4 flex items-center gap-2 text-gray-900">
                                <CreditCard className="w-5 h-5 text-blue-600"/>
                                Fakturační údaje
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                                <div>
                                    <h4 className="font-semibold text-gray-900 mb-2">Dodavatel:</h4>
                                    <p className="text-gray-700">EKV Project s.r.o.</p>
                                    <p className="text-gray-700">Papírnická 2809/16</p>
                                    <p className="text-gray-700">326 00 Plzeň</p>
                                    <p className="text-gray-700">IČO: 10793615</p>
                                    <p className="text-gray-700">DIČ: CZ10793615</p>
                                </div>
                                <div>
                                    <h4 className="font-semibold text-gray-900 mb-2">Odběratel:</h4>
                                    <p className="text-gray-700">{order.subjects.name}</p>
                                    <p className="text-gray-700">{order.subjects.address || 'Adresa není uvedena'}</p>
                                    <p className="text-gray-700">{order.subjects.city || ''} {order.subjects.postal_code || ''}</p>
                                    <p className="text-gray-700">IČO: {order.subjects.ico || 'Není uvedeno'}</p>
                                    <p className="text-gray-700">DIČ: {order.subjects.dic || 'Není uvedeno'}</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    export default SubcontractorOrderPage;
