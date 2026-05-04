import React, { useState, useEffect } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { FormDialogBody, FormDialogContent, FormDialogFooter, FormDialogHeader } from '@/components/ui/form-dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { CheckCircle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { sendPayoutApprovalEmail } from '@/lib/email';
import { sendAdminPayoutNotification } from '@/lib/payoutEmailService';
import { useToast } from '@/components/ui/use-toast';

const AdminPayoutApprovalDialog = ({ isOpen, onClose, payout, onConfirm }) => {
  const [adminNote, setAdminNote] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (isOpen) {
      setAdminNote('');
      setError('');
    }
  }, [isOpen]);

  const handleSubmit = async () => {
    setError('');

    if (adminNote.length > 500) {
      setError('Poznámka administrátora může mít maximálně 500 znaků.');
      return;
    }

    setIsSubmitting(true);
    try {
      await onConfirm(payout.id, adminNote, false);
      
      // Send emails
      const memberResult = await sendPayoutApprovalEmail({
        memberId: payout.member_id,
        amount: payout.amount,
        approved_without_invoice: false
      });
      
      const adminResult = await sendAdminPayoutNotification({
        memberName: payout.members?.name || 'Pracovník',
        amount: payout.amount,
        action: 'Schválení žádosti'
      });
      
      if (!memberResult?.success || !adminResult?.success) {
        toast({ title: "Schváleno, ale notifikace selhala", description: memberResult?.error || adminResult?.error, variant: "warning" });
      } else {
        toast({ title: "Schváleno", description: "Zaměstnanec byl vyzván k nahrání faktury." });
      }
      onClose();
    } catch (err) {
      setError('Při schvalování došlo k chybě: ' + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!payout) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <FormDialogContent size="md">
        <FormDialogHeader
          title="Schválení výplaty"
          description={<>Schvalujete žádost o výplatu pro: <strong className="text-slate-900">{payout.members?.name || 'Neznámý'}</strong></>}
        />

        <FormDialogBody className="space-y-6">
          <Alert className="bg-blue-50 text-blue-900 border-blue-200">
            <CheckCircle className="h-4 w-4 text-blue-600" />
            <AlertTitle>Schválení je první krok</AlertTitle>
            <AlertDescription>Po schválení bude žádost čekat na fakturu od zaměstnance. Teprve po jejím nahrání ji půjde označit jako vyplacenou a uzavřít.</AlertDescription>
          </Alert>

          <div className="space-y-2">
            <Label htmlFor="admin-note">Poznámka (volitelné)</Label>
            <Textarea id="admin-note" placeholder="Interní poznámka ke schválení..." value={adminNote} onChange={(e) => setAdminNote(e.target.value)} className="resize-none h-24" maxLength={500} />
            <div className="text-right text-xs text-slate-400">{adminNote.length}/500</div>
          </div>

          {error && <div className="text-sm font-medium text-red-600 bg-red-50 p-3 rounded-md border border-red-100">{error}</div>}
        </FormDialogBody>

        <FormDialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>Zrušit</Button>
          <Button onClick={handleSubmit} disabled={isSubmitting} className="bg-emerald-600 hover:bg-emerald-700">{isSubmitting ? 'Schvaluji...' : 'Schválit výplatu'}</Button>
        </FormDialogFooter>
      </FormDialogContent>
    </Dialog>
  );
};

export default AdminPayoutApprovalDialog;
