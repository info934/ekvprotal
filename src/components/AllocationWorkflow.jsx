import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Save, Send, Check, X, Repeat, History } from 'lucide-react';
import { format } from 'date-fns';

const statusConfig = {
  DRAFT: { label: 'Koncept', variant: 'secondary' },
  PENDING_APPROVAL: { label: 'Čeká na schválení', variant: 'warning' },
  APPROVED: { label: 'Schváleno', variant: 'success' },
};

const AllocationWorkflow = ({ allocation, onUpdate, onSaveDraft }) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [notes, setNotes] = useState('');
  const [auditLog, setAuditLog] = useState([]);
  const [showLog, setShowLog] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    const fetchAuditLog = async () => {
      if (!allocation?.id) return;
      const { data, error } = await supabase
        .from('overhead_audit_logs')
        .select('*')
        .eq('monthly_allocation_id', allocation.id)
        .order('created_at', { ascending: false });
      if (error) {
        toast({ title: 'Chyba načítání historie', variant: 'destructive' });
      } else {
        setAuditLog(data);
      }
    };
    fetchAuditLog();
  }, [allocation, toast]);

  const handleApprove = async () => {
    setIsProcessing(true);
    try {
        // Fetch allocation items
        const { data: items, error: itemsError } = await supabase
            .from('overhead_allocation_items')
            .select(`
                id,
                project_id,
                amount_allocated
            `)
            .eq('overhead_monthly_allocation_id', allocation.id);

        if (itemsError) throw itemsError;

        const projectOverheadCostsToInsert = items.map(item => ({
            project_id: item.project_id,
            overhead_allocation_item_id: item.id,
            amount: item.amount_allocated,
            month: allocation.month,
        }));
        
        // Remove old overhead costs associated with this allocation to prevent duplicates if re-approved
        const { error: deleteError } = await supabase
            .from('project_overhead_costs')
            .delete()
            .in('overhead_allocation_item_id', items.map(i => i.id));

        if (deleteError) {
          toast({ title: 'Chyba při odstraňování starých režijních nákladů', description: deleteError.message, variant: 'destructive' });
        }


        if (projectOverheadCostsToInsert.length > 0) {
            const { error: insertError } = await supabase
                .from('project_overhead_costs')
                .insert(projectOverheadCostsToInsert);
            if (insertError) throw insertError;
        }
        
        await handleStatusChange('APPROVED', 'Schváleno a zaúčtováno');
    } catch (error) {
        toast({ title: 'Chyba při schvalování a zaúčtování', description: error.message, variant: 'destructive' });
    } finally {
        setIsProcessing(false);
    }
  };
  
  const handleRevertToDraft = async () => {
    setIsProcessing(true);
    try {
        const { data: items, error: itemsError } = await supabase
            .from('overhead_allocation_items')
            .select('id')
            .eq('overhead_monthly_allocation_id', allocation.id);

        if (itemsError) throw itemsError;
        
        if (items.length > 0) {
            const { error: deleteError } = await supabase
                .from('project_overhead_costs')
                .delete()
                .in('overhead_allocation_item_id', items.map(i => i.id));
            
            if (deleteError) throw deleteError;
        }

        await handleStatusChange('DRAFT', 'Znovuotevřeno a zaúčtování zrušeno');
    } catch (error) {
        toast({ title: 'Chyba při znovuotevření', description: error.message, variant: 'destructive' });
    } finally {
        setIsProcessing(false);
    }
  };

  const handleStatusChange = async (newStatus, actionText) => {
    if (!allocation) {
        toast({ title: 'Chyba', description: 'Vyúčtování nebylo inicializováno.', variant: 'destructive' });
        return;
    }
    // First, save the draft to ensure all items are stored
    await onSaveDraft();
    
    // Then, update status and create audit log
    const { error: updateError } = await supabase
      .from('overhead_monthly_allocations')
      .update({ status: newStatus, notes, updated_by: user.id })
      .eq('id', allocation.id);

    if (updateError) {
      toast({ title: 'Chyba změny stavu', description: updateError.message, variant: 'destructive' });
      return;
    }
    
    const { error: logError } = await supabase.from('overhead_audit_logs').insert({
        monthly_allocation_id: allocation.id,
        user_id: user.id,
        user_email: user.email,
        action: actionText,
        details: { newStatus, notes }
    });
    
    if (logError) console.error("Error creating audit log:", logError);

    toast({ title: `✅ Stav změněn na: ${statusConfig[newStatus].label}` });
    setNotes('');
    onUpdate();
  };

  const currentStatus = allocation?.status || 'DRAFT';
  const config = statusConfig[currentStatus];

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <span className="font-semibold">Aktuální stav:</span>
        <Badge variant={config.variant}>{config.label}</Badge>
      </div>

      {currentStatus === 'DRAFT' && (
        <div className="space-y-2">
          <Button onClick={onSaveDraft} className="w-full"><Save className="mr-2 h-4 w-4" /> Uložit koncept</Button>
          <Button onClick={() => handleStatusChange('PENDING_APPROVAL', 'Odesláno ke schválení')} className="w-full"><Send className="mr-2 h-4 w-4" /> Odeslat ke schválení</Button>
        </div>
      )}

      {currentStatus === 'PENDING_APPROVAL' && (
        <div className="space-y-2">
          <Button onClick={handleApprove} className="w-full bg-green-600 hover:bg-green-700" disabled={isProcessing}>
            {isProcessing ? 'Zpracovávám...' : <><Check className="mr-2 h-4 w-4" /> Schválit a Zaúčtovat</>}
          </Button>
          <div className="space-y-2 pt-2 border-t">
            <Textarea placeholder="Poznámka pro vrácení..." value={notes} onChange={(e) => setNotes(e.target.value)} />
            <Button onClick={() => handleStatusChange('DRAFT', 'Vráceno k přepracování')} variant="destructive" className="w-full"><X className="mr-2 h-4 w-4" /> Vrátit k přepracování</Button>
          </div>
        </div>
      )}

      {currentStatus === 'APPROVED' && (
        <div className="space-y-2">
          <p className="text-sm text-green-600 text-center p-2 bg-green-50 rounded-md">Toto vyúčtování je finálně schváleno a náklady byly promítnuty do projektů.</p>
          <Button onClick={handleRevertToDraft} variant="outline" className="w-full" disabled={isProcessing}>
            {isProcessing ? 'Zpracovávám...' : <><Repeat className="mr-2 h-4 w-4" /> Znovu otevřít</>}
          </Button>
        </div>
      )}
      
      <div className="pt-4 border-t">
        <Button variant="link" onClick={() => setShowLog(!showLog)} className="p-0 h-auto">
          <History className="mr-2 h-4 w-4" />
          {showLog ? 'Skrýt historii' : 'Zobrazit historii'}
        </Button>
        {showLog && (
          <div className="mt-2 space-y-2 text-xs text-muted-foreground">
            {auditLog.length > 0 ? auditLog.map(log => (
              <div key={log.id} className="p-2 border rounded-md">
                <p><strong>{log.action}</strong> - {log.user_email}</p>
                <p>{format(new Date(log.created_at), 'd.M.yyyy HH:mm')}</p>
                {log.details?.notes && <p className="italic mt-1">Pozn.: "{log.details.notes}"</p>}
              </div>
            )) : <p>Žádná historie.</p>}
          </div>
        )}
      </div>
    </div>
  );
};

export default AllocationWorkflow;