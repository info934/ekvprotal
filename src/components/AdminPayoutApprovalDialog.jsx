import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { AlertCircle, CheckCircle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { sendPayoutApprovalEmail } from '@/lib/email';
import { sendAdminPayoutNotification } from '@/lib/payoutEmailService';
import { useToast } from '@/components/ui/use-toast';

const AdminPayoutApprovalDialog = ({ isOpen, onClose, payout, onConfirm }) => {
  const [isWithoutInvoice, setIsWithoutInvoice] = useState(false);
  const [adminNote, setAdminNote] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (isOpen) {
      setIsWithoutInvoice(false);
      setAdminNote('');
      setError('');
    }
  }, [isOpen]);

  const handleSubmit = async () => {
    setError('');
    
    const hasInvoice = !!payout?.invoice_url;
    if (!hasInvoice && !isWithoutInvoice) {
      setError('K této žádosti není přiložena faktura. Musíte potvrdit, že schvalujete výplatu bez faktury.');
      return;
    }

    if (adminNote.length > 500) {
      setError('Poznámka administrátora může mít maximálně 500 znaků.');
      return;
    }

    setIsSubmitting(true);
    try {
      await onConfirm(payout.id, adminNote, isWithoutInvoice);
      
      // Send emails
      await sendPayoutApprovalEmail({ 
        memberId: payout.member_id, 
        amount: payout.amount, 
        approved_without_invoice: isWithoutInvoice 
      });
      
      await sendAdminPayoutNotification({
        memberName: payout.members?.name || 'Pracovník',
        amount: payout.amount,
        action: 'Schválení žádosti'
      });
      
      toast({ title: "Notifikace odeslány", description: "Email byl odeslán uživateli." });
      onClose();
    } catch (err) {
      setError('Při schvalování došlo k chybě: ' + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!payout) return null;

  const hasInvoice = !!payout.invoice_url;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Schválení výplaty</DialogTitle>
          <DialogDescription>
            Schvalujete žádost o výplatu pro: <strong className="text-slate-900">{payout.members?.name || 'Neznámý'}</strong>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {hasInvoice ? (
            <Alert className="bg-emerald-50 text-emerald-800 border-emerald-200">
              <CheckCircle className="h-4 w-4 text-emerald-600" />
              <AlertTitle>Faktura je přiložena</AlertTitle>
              <AlertDescription>K této žádosti již byla nahrána faktura. Můžete standardně schválit.</AlertDescription>
            </Alert>
          ) : (
            <Alert className="bg-amber-50 text-amber-800 border-amber-200">
              <AlertCircle className="h-4 w-4 text-amber-600" />
              <AlertTitle>Chybí faktura</AlertTitle>
              <AlertDescription>Tato žádost zatím nemá přiloženou fakturu. Chcete-li ji přesto schválit k vyplacení, musíte to výslovně potvrdit.</AlertDescription>
            </Alert>
          )}

          <div className="flex items-start space-x-3 p-4 bg-slate-50 rounded-lg border border-slate-100">
            <Checkbox id="without-invoice" checked={isWithoutInvoice} onCheckedChange={setIsWithoutInvoice} className="mt-1" />
            <div className="space-y-1 leading-none">
              <Label htmlFor="without-invoice" className="font-semibold cursor-pointer">Potvrzuji, že výplata je bez faktury</Label>
              <p className="text-sm text-slate-500">Zaškrtnutím umožníte vyplacení této částky bez nutnosti dokládat účetní fakturu do systému.</p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="admin-note">Poznámka (volitelné)</Label>
            <Textarea id="admin-note" placeholder="Důvod schválení bez faktury nebo jiné poznámky k vyplacení..." value={adminNote} onChange={(e) => setAdminNote(e.target.value)} className="resize-none h-24" maxLength={500} />
            <div className="text-right text-xs text-slate-400">{adminNote.length}/500</div>
          </div>

          {error && <div className="text-sm font-medium text-red-600 bg-red-50 p-3 rounded-md border border-red-100">{error}</div>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>Zrušit</Button>
          <Button onClick={handleSubmit} disabled={isSubmitting} className="bg-emerald-600 hover:bg-emerald-700">{isSubmitting ? 'Schvaluji...' : 'Schválit výplatu'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AdminPayoutApprovalDialog;