import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FilePieChart } from 'lucide-react';

const RealizaceOverheadSummary = () => {
    const [overhead, setOverhead] = useState(null);
    const { toast } = useToast();

    useEffect(() => {
        const fetchOverhead = async () => {
            const { data, error } = await supabase.rpc('get_realizace_overhead_summary');
            if (error) {
                toast({ title: 'Chyba při načítání režií realizace', variant: 'destructive' });
            } else {
                setOverhead(data[0]?.total_overhead || 0);
            }
        };
        fetchOverhead();
    }, [toast]);
    
    // Future integration point for Forecast module:
    // This component provides the total overhead for Realizace. The Forecast module can
    // combine this with overhead from Projekce to show total company-wide overhead.
    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Režie na realizacích</CardTitle>
                <FilePieChart className="h-4 w-4 text-muted-foreground text-orange-500" />
            </CardHeader>
            <CardContent>
                <div className="text-2xl font-bold">
                    {overhead !== null ? new Intl.NumberFormat('cs-CZ', { style: 'currency', currency: 'CZK' }).format(overhead) : 'Načítání...'}
                </div>
                <p className="text-xs text-muted-foreground">Celkové alokované režie</p>
            </CardContent>
        </Card>
    );
};

export default RealizaceOverheadSummary;